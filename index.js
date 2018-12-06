const moderator_channel = process.env.MODERATOR_CHANNEL;
const secret = process.env.AWS_SECRET;
const default_token = process.env.DEFAULT_TOKEN;

let payload, secrets, slack;

/**
 * Get Slack tokens from memory or AWS SecretsManager.
 */
function getSecrets() {
  if (secrets) {
    console.log(`CACHED ${secret}`);
    return Promise.resolve(secrets);
  } else {
    console.log(`FETCH ${secret}`);
    const AWS = require('aws-sdk');
    const secretsmanager = new AWS.SecretsManager();
    return secretsmanager.getSecretValue({
      SecretId: secret
    }).promise().then((data) => {
      secrets = JSON.parse(data.SecretString);
      return secrets;
    });
  }
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
      slack = new WebClient(secrets[default_token]);
      resolve(slack);
    }
  });
}

/**
 * Get payload from SNS message.
 *
 * @param {object} event SNS event object.
 */
function getPayload(event) {
  return new Promise((resolve, reject) => {
    event.Records.map((record) => {
      payload = JSON.parse(Buffer.from(record.Sns.Message, 'base64'));
      console.log(`PAYLOAD ${JSON.stringify(payload)}`);
      resolve(payload);
    });
  });
}

/**
 * Send report message confirmation to user.
 *
 * @param {object} payload Slack payload.
 */
function reportMessage(payload) {
  // Get permalink to reported message
  const options = {channel: payload.channel.id, message_ts: payload.message.ts};
  console.log(`GET PERMALINK ${JSON.stringify(options)}`);
  return slack.bot.chat.getPermalink(options).then((msg) => {
    console.log(`PERMALINK ${JSON.stringify(msg)}`);

    // Open DM with reporter
    const options = {user: payload.user.id};
    console.log(`OPEN IM ${JSON.stringify(options)}`);
    return slack.bot.im.open(options).then((dm) => {
      console.log(`IM ${JSON.stringify(dm)}`);

      // Send DM to reporter
      const value = {
        post: {
          channel: payload.channel.id,
          permalink: msg.permalink,
          ts: payload.message.ts,
          user: payload.message.user
        },
        report: {
          user: payload.user.id,
          ts: payload.action_ts
        }
      };
      const options = {
        attachments: [
          {
            actions: [
              {
                name: 'report',
                text: 'Report',
                type: 'button',
                value: Buffer.from(JSON.stringify(value)).toString('base64')
              }
            ],
            callback_id: 'compose_report',
            color: 'danger',
            footer: `Posted in <#${payload.channel.id}> by <@${payload.message.user}>`,
            mrkdwn_in: ['text'],
            text: payload.message.text,
            ts: payload.message.ts
          }
        ],
        channel: dm.channel.id,
        text: 'Report this message?'
      };
      console.log(`SEND DM ${JSON.stringify(options)}`);
      return slack.bot.chat.postMessage(options).then((res) => {
        console.log(`DM ${JSON.stringify(res)}`);
        return res;
      });
    });
  });
}

/**
 * Open dialog to take report.
 *
 * @param {object} payload Slack payload.
 */
function composeReport(payload) {
  // Get permalink to confirmation report
  const options = {
    channel: payload.channel.id,
    message_ts: payload.original_message.ts
  };
  console.log(`GET PERMALINK ${JSON.stringify(options)}`);
  return slack.bot.chat.getPermalink(options).then((msg) => {
    console.log(`PERMALINK ${JSON.stringify(msg)}`);

    // Open dialog to take report
    const options = {
      dialog: {
        callback_id: 'submit_report',
        title: 'Report Message',
        submit_label: 'Send',
        elements: [
          {
            hint: 'This report will be posted to the moderators.',
            label: 'Reason',
            name: 'reason',
            placeholder: 'Why is this message being reported?',
            type: 'textarea'
          },
          {
            hint: 'Do not alter this value.',
            label: 'Permalink',
            name: 'permalink',
            type: 'text',
            value: msg.permalink
          }
        ]
      },
      trigger_id: payload.trigger_id
    };
    console.log(`OPEN DIALOG ${JSON.stringify(options)}`);
    return slack.bot.dialog.open(options).then((dialog) => {
      console.log(`DIALOG ${JSON.stringify(dialog)}`);
      return dialog;
    });
  });
}

/**
 * Post report to moderator channel.
 *
 * @param {object} payload Slack payload.
 */
function submitReport(payload) {
  // Get original message from submission
  return getMessage(payload.submission.permalink).then((message) => {

    // Send report
    const attachment = message.attachments[0];
    const action = attachment.actions[0];
    const value = JSON.parse(Buffer.from(action.value, 'base64'));
    const options = {
      channel: moderator_channel || 'GB1SLKKL7',
      text: 'A message has been reported.',
      attachments: [
        {
          color: 'warning',
          footer: `Reported by <@${payload.user.id}>`,
          text: payload.submission.reason,
          ts: payload.action_ts
        },
        {
          actions: [
            {
              name: 'send_message',
              text: 'Send Message',
              type: 'button',
              value: Buffer.from(JSON.stringify(value)).toString('base64')
            }
          ],
          callback_id: 'compose_response',
          color: 'danger',
          footer: attachment.footer,
          mrkdwn_in: ['text'],
          text: attachment.text,
          ts: attachment.ts
        }
      ]
    };
    console.log(`SUBMIT ${JSON.stringify(options)}`);
    return slack.bot.chat.postMessage(options).then((rpt) => {
      console.log(`REPORT ${JSON.stringify(rpt)}`);

      // Update original
      message.channel = channel;
      message.attachments[0].actions = [];
      message.attachments = message.attachments.concat([
        {
          color: 'warning',
          footer: `Reported by <@${payload.user.id}>`,
          text: 'Report submitted.',
          ts: rpt.ts
        }
      ]);
      console.log(`UPDATE ${JSON.stringify(message)}`);
      return slack.bot.chat.update(message).then((up) => {
        console.log(`UPDATED ${JSON.stringify(up)}`);
        return up;
      });
    });
  });
}

/**
 * Open dialog to compose message.
 *
 * @param {object} payload Slack payload.
 */
function composeResponse(payload) {
  // Get permalink to report DM
  const value = JSON.parse(Buffer.from(payload.actions[0].value, 'base64'));
  const options = {channel: value.report.channel, message_ts: value.report.ts};
  console.log(`GET PERMALINK ${JSON.stringify(options)}`);
  return slack.bot.chat.getPermalink(options).then((msg) => {
    console.log(`PERMALINK ${JSON.stringify(msg)}`);

    // Open DM with poster
    const options = {user: value.post.user};
    console.log(`OPEN DM ${JSON.stringify(options)}`);
    return slack.bot.im.open(options).then((dm) => {
      console.log(`DM ${JSON.stringify(dm)}`);

      // Open dialog
      const options = {
        trigger_id: payload.trigger_id,
        dialog: {
          callback_id: 'submit_response',
          elements: [
            {
              hint: 'Users will not be able to reply to DMs.',
              label: 'Response Type',
              name: 'response_type',
              options: [
                {
                  label: `Send Warning`,
                  value: 'warn'
                },
                {
                  label: `Reply to Thread`,
                  value: 'reply'
                },
                {
                  label: `Respond to Reporter`,
                  value: 'respond'
                }
              ],
              type: 'select'
            },
            {
              hint: 'The reported message will be included in the response.',
              label: 'Message',
              name: 'message',
              placeholder: 'Moderator response...',
              type: 'textarea'
            },
            {
              hint: 'Do not alter this value.',
              label: 'Permalink',
              name: 'permalink',
              type: 'text',
              value: msg.permalink
            }
          ],
          submit_label: 'Respond',
          title: 'Moderator Response'
        }
      };
      console.log(`OPEN DIALOG ${JSON.stringify(options)}`);
      return slack.bot.dialog.open(options);
    });
  });
}

/**
 * Get Slack message from DM permalink.
 *
 * @param {string} permalink Slack permalink URL
 */
function getMessage(permalink) {
  const pattern = /https:\/\/.*?.slack.com\/archives\/(.*?)\/p(\d{10})(\d{6})/;
  const match = permalink.match(pattern);
  const channel = match[1];
  const ts = match.slice(2, 4).join('.');

  const options = {
    channel: channel,
    count: 1,
    inclusive: true,
    latest: ts
  };
  console.log(`SEARCH HISTORY ${JSON.stringify(options)}`);
  return slack.bot.conversations.history(options).then((res) => {
    const message = res.messages[0];
    message.channel = channel;
    console.log(`MESSAGE ${JSON.stringify(message)}`);
    return message;
  });
}

/**
 * Open dialog to report message.
 *
 * @param {object} event SNS event object.
 */
function reportMessageAction(payload) {
  return slack.chat.getPermalink({
    channel: payload.channel.id,
    message_ts: payload.message.ts
  }).then((res) => {
    console.log(`PERMALINK ${res.permalink}`);
    const dialog = {
      callback_id: 'report_message_submit',
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
    return slack.bot.dialog.open({
      trigger_id: payload.trigger_id,
      dialog: dialog
    });
  });
}

/**
 * Post report to moderator channel.
 *
 * @param {object} payload Slack payload.
 * @param {string} remove remove_message or
 */
function reportMessageSubmit(payload) {
  const channel = payload.submission.permalink.match(/archives\/(.*?)\//)[1];
  const options = {
    channel: moderator_channel,
    text: 'A message has been reported.',
    attachments: [
      {
        color: 'warning',
        footer: `Reported by <@${payload.user.id}>`,
        text: payload.submission.reason,
        ts: payload.action_ts,
      },
      {
        callback_id: 'moderator_action',
        color: 'danger',
        footer: `Posted in <#${channel}>`,
        mrkdwn_in: ['text'],
        text: payload.submission.permalink,
        ts: payload.action_ts,
      }
    ]
  };
  console.log(`REPORT ${JSON.stringify(options)}`);
  return slack.chat.postMessage(options).then((res) => {
    const options = {user: payload.user.id};
    console.log(`OPEN DM ${JSON.stringify(options)}`);
    return slack.im.open(options);
  }).then((res) => {
    const options = {
      channel: res.channel.id,
      text: 'We have received your report.',
      attachments: [
        {
          color: 'warning',
          footer: `Reported by <@${payload.user.id}>`,
          text: payload.submission.reason,
          ts: payload.action_ts
        }
      ]
    };
    console.log(`DM RECEIPT ${JSON.stringify(options)}`);
    return slack.chat.postMessage(options);
  });
}

/**
 * Handle SNS message.
 *
 * @param {object} event SNS event object.
 * @param {object} context SNS event context.
 * @param {function} callback Lambda callback function.
 */
function handler(event, context, callback) {
  console.log(`EVENT ${JSON.stringify(event)}`);
  return getPayload(event).then(getSecrets).then(getSlack).then(() => {
    console.log(`CALLBACK ${payload.callback_id}`);

    // Open dialog to report message
    if (payload.callback_id === 'report_message_action') {
      return reportMessageAction(payload);
    }

    // Post report to moderator channel
    else if (payload.callback_id === 'report_message_submit') {
      return reportMessageSubmit(payload);
    }
  }).then((res) => {
    callback();
  }).catch((err) => {
    console.error(`ERROR ${JSON.stringify(err)}`);
    callback(err);
  });
}

exports.handler = handler;
