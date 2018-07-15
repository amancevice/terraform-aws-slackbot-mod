const remove_callback_id = process.env.REMOVE_CALLBACK_ID;
const report_callback_id = process.env.REPORT_CALLBACK_ID;
const moderation_channel = process.env.MODERATION_CHANNEL;

let secrets, payload, slack;

/**
 * Get Slack tokens from memory or AWS SecretsManager.
 */
function getSecrets() {
  return new Promise((resolve, reject) => {
    if (secrets) {
      resolve(secrets);
    } else {
      const secret = process.env.SECRET;
      console.log(`FETCH ${secret}`);
      const AWS = require('aws-sdk');
      const secretsmanager = new AWS.SecretsManager();
      secretsmanager.getSecretValue({SecretId: secret}, (err, data) => {
        if (err) {
          reject(err);
        } else {
          console.log(`RECEIVED ${secret}`);
          secrets = JSON.parse(data.SecretString);
          resolve(secrets);
        }
      });
    }
  });
}

/**
 * Get Slack client.
 */
function getSlack() {
  return new Promise((resolve, reject) => {
    if (slack) {
      resolve(slack);
    } else {
      const { WebClient } = require('@slack/client');
      slack = new WebClient(secrets.ACCESS_TOKEN);
      resolve(slack);
    }
  });
}

/**
 * Get Slack message from permalink.
 *
 * @param {string} permalink Slack permalink URL
 */
function getMessage(permalink) {
  const pattern = /https:\/\/.*?.slack.com\/archives\/(.*?)\/p(\d{10})(\d{6})/;
  const match = permalink.match(pattern);
  const channel = match[1];
  const ts = +match.slice(2, 4).join('.');

  if (permalink.match(/thread_ts=/)) {
    const thread_ts = +permalink.match(/thread_ts=(\d{10}\.\d{6})/)[1];
    const options = {
      channel: channel,
      thread_ts: thread_ts,
      ts: ts
    };
    console.log(`REPLIES ${JSON.stringify(options)}`);
    return slack.conversations.replies(options).then((res) => {
      console.log(`MESSAGE ${JSON.stringify(res.messages[0])}`);
      return res.messages[0];
    });
  } else {
    const options = {
      channel: channel,
      count: 1,
      inclusive: true,
      latest: ts
    };
    console.log(`HISTORY ${JSON.stringify(options)}`);
    return slack.conversations.history(options).then((res) => {
      console.log(`MESSAGE ${res.messages[0]}`);
      return res.messages[0];
    });
  }
}

/**
 * Get reasoning for thread deletion.
 *
 * @param {object} event SNS event object.
 */
function openDialog(event) {
  // Log it
  console.log(`EVENT ${JSON.stringify(event)}`);

  // Map it
  event.Records.map((record) => {

    // Parse it
    payload = JSON.parse(Buffer.from(record.Sns.Message, 'base64').toString());

    // Post it
    console.log(`PAYLOAD ${JSON.stringify(payload)}`);
    return slack.chat.getPermalink({
        channel: payload.channel.id,
        message_ts: payload.message.ts
      }).then((res) => {
        console.log(`PERMALINK ${res.permalink}`);
        const dialog = {
          callback_id: report_callback_id,
          title: 'Report Message',
          submit_label: 'Send',
          elements: [
            {
              hint: 'This will be posted to the moderators.',
              label: 'Reason',
              name: 'reason',
              placeholder: 'Why is this thread being reported?',
              type: 'textarea'
            },
            {
              hint: 'Do not alter this value.',
              label: 'Permalink',
              name: 'permalink',
              type: 'text',
              value: res.permalink
            }
          ]
        };
        console.log(`DIALOG ${JSON.stringify(dialog)}`);
        return slack.dialog.open({
          trigger_id: payload.trigger_id,
          dialog: dialog
        });
      });
  });
}

/**
 * Post report to mod channel.
 *
 * @param {object} event SNS event object.
 */
function postReport(event) {
  // Log it
  console.log(`EVENT ${JSON.stringify(event)}`);

  // Map it
  event.Records.map((record) => {

    // Parse it
    payload = JSON.parse(Buffer.from(record.Sns.Message, 'base64').toString());

    // Post it
    console.log(`PAYLOAD ${JSON.stringify(payload)}`);
    getMessage(payload.submission.permalink).then((msg) => {
      const ts_short = Math.floor(msg.ts);
      const remove_message = {
        name: 'remove_message',
        text: 'Remove Message',
        value: 'remove_message',
        type: 'button'
      };
      const remove_thread = {
        name: 'remove_thread',
        text: 'Remove Thread',
        style: 'danger',
        type: 'button',
        value: 'remove_thread',
        confirm: {
          title: 'Are you sure?',
          text: 'This will delete the *entire* thread.',
          ok_text: 'Yes',
          dismiss_text: 'No'
        }
      };
      const actions = msg.thread_ts === undefined ? [remove_message] : [remove_message, remove_thread];
      return slack.chat.postMessage({
          channel: moderation_channel,
          text: 'A message has been reported.',
          attachments: [
            {
              color: 'warning',
              fields: [
                {
                  title: 'Reported By',
                  value: `<@${payload.user.id}>`,
                  short: true
                },
                {
                  title: 'Posted',
                  value: `<!date^${ts_short}^{date_short_pretty} {time}|unknown>`,
                  short: true
                },
                {
                  title: 'Reason',
                  value: `${payload.submission.reason}`,
                  short: false
                }
              ]
            },
            {
              callback_id: remove_callback_id,
              color: 'danger',
              fields: [
                {
                  title: 'Author',
                  value: `<@${msg.user}>`,
                  short: true
                },
                {
                  title: 'Channel',
                  value: `<#${msg.channel}>`,
                  short: true
                },
                {
                  title: 'Link',
                  value: `<${payload.submission.permalink}|${payload.team.domain}.slack.com>`,
                  short: false
                },
                {
                  title: 'Message',
                  value: `${msg.text}`,
                  short: false
                }
              ],
              actions: actions
            }
          ]
        });
    });
  });
}

/**
 * Delete thread.
 *
 * @param {object} event SNS event object.
 */
function removeMessage(event) {
  // Log it
  console.log(`EVENT ${JSON.stringify(event)}`);

  // Map it
  event.Records.map((record) => {

    // Parse it
    payload = JSON.parse(Buffer.from(record.Sns.Message, 'base64').toString());

    // Post it
    console.log(`PAYLOAD ${JSON.stringify(payload)}`);
    const permalink = payload.original_message.attachments[1].fields[2].value.replace(/^<|\|.*?>$/g, '');
    const channel = permalink.match(/archives\/(.*?)\//)[1];
    console.log(`PERMALINK ${permalink}`);
    return getMessage(permalink).then((msg) => {
      if (payload.actions[0].value === 'remove_message') {
        console.log(`DELETING ${msg.ts}`);
        return slack.chat.delete({
            channel: channel,
            ts: msg.ts
          }).then((res) => {
            updateReport(payload.original_message);
          });
      } else if (payload.actions[0].value === 'remove_thread') {
        return slack.conversations.replies({
            channel: channel,
            ts: msg.thread_ts
          }).then((res) => {
              return Promise.all(
                res.messages.reverse().map((rep) => {
                  console.log(`DELETING ${JSON.stringify(rep.ts)}`);
                  slack.chat.delete({channel: channel, ts: rep.ts});
                })
              );
            }).then((res) => {
              return slack.chat.delete({channel: channel, ts: msg.thread_ts});
            }).then((res) => {
              return updateReport(payload.original_message);
            });
      }
    })
  });
}

/**
 * Remove actions from report.
 *
 * @param {object} original_message Original message from Slack.
 */
function updateReport(original_message) {
  return slack.chat.update({
    channel: moderation_channel,
    ts: payload.original_message.ts,
    text: payload.original_message.text,
    attachments: [
      payload.original_message.attachments[0],
      {
        callback_id: payload.original_message.attachments[1].callback_id,
        color: 'danger',
        fields: payload.original_message.attachments[1].fields
      }
    ]
  });
}

/**
 * Get reasoning for thread deletion.
 *
 * @param {object} event SNS event object.
 * @param {object} context SNS event context.
 * @param {function} callback Lambda callback function.
 */
function dialog(event, context, callback) {
  return getSecrets().then((res) => {
      return getSlack();
    }).then((res) => {
      return openDialog(event);
    }).then((res) => {
      callback(null, res);
    }).catch((err) => {
      console.error(`ERROR ${err}`);
      callback(err);
    });
}

/**
 * Post to mod channel.
 *
 * @param {object} event SNS event object.
 * @param {object} context SNS event context.
 * @param {function} callback Lambda callback function.
 */
function report(event, context, callback) {
  return getSecrets().then((res) => {
      return getSlack();
    }).then((res) => {
      return postReport(event);
    }).then((res) => {
      callback(null, res);
    }).catch((err) => {
      console.error(`ERROR ${err}`);
      callback(err);
    });
}

/**
 * Delete thread.
 *
 * @param {object} event SNS event object.
 * @param {object} context SNS event context.
 * @param {function} callback Lambda callback function.
 */
function remove(event, context, callback) {
  return getSecrets().then((res) => {
      return getSlack();
    }).then((res) => {
      return removeMessage(event);
    }).then((res) => {
      callback(null, res);
    }).catch((err) => {
      console.error(`ERROR ${err}`);
      callback(err);
    });
}

exports.dialog = dialog;
exports.report = report;
exports.remove = remove;
