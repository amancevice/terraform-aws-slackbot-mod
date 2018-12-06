const moderator_channel = process.env.MODERATOR_CHANNEL;

let payload, secrets, slack;

/**
 * Get Slack tokens from memory or AWS SecretsManager.
 */
function getSecrets() {
  return new Promise((resolve, reject) => {
    if (secrets) {
      resolve(secrets);
    } else {
      const secret = process.env.AWS_SECRET;
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
      slack = {
        bot: new WebClient(secrets.BOT_ACCESS_TOKEN),
        user: new WebClient(secrets.USER_ACCESS_TOKEN)
      };
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
  return slack.bot.chat.getPermalink({
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
function reportMessageSubmit(payload, remove) {
  return getMessage(payload.submission.permalink).then((msg) => {
    const warn_user = {
      name: 'warn_action',
      text: 'Send Warning',
      type: 'button',
      value: payload.submission.permalink
    };
    const remove_message = {
      name: 'remove_action',
      style: 'danger',
      text: 'Remove Message',
      type: 'button',
      value: payload.submission.permalink
    };
    const actions = [warn_user];
    const channel = payload.submission.permalink.match(/archives\/(.*?)\//)[1];
    const options = {
      channel: moderator_channel,
      text: 'A message has been reported.',
      attachments: [
        {
          color: 'warning',
          footer: `Reported by <@${payload.user.id}>`,
          text: payload.submission.reason,
          ts: payload.action_ts
        },
        {
          callback_id: 'moderator_action',
          color: 'danger',
          footer: `Posted in <#${channel}> by <@${msg.user}>`,
          mrkdwn_in: ['text'],
          text: `<${payload.submission.permalink}|*Permalink*>\n${msg.text}`,
          ts: msg.ts,
          actions: actions
        }
      ]
    };
    console.log(`REPORT ${JSON.stringify(options)}`);
    return slack.bot.chat.postMessage(options);
  }).then((res) => {
    const options = {user: payload.user.id};
    console.log(`OPEN DM ${JSON.stringify(options)}`);
    return slack.bot.im.open(options);
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
    return slack.bot.chat.postMessage(options);
  });
}

/**
 * Open dialog to take moderator action.
 *
 * @param {object} payload Slack payload.
 */
function moderatorAction(payload, permalink, value) {
  const options = {
    private_dm: [
      {
        label: 'Warn in Private DM',
        value: 'private_dm'
      },
      {
        label: 'Warn in Thread',
        value: 'post_in_thread'
      }
    ],
    remove_message: [
      {
        label: 'Remove Message',
        value: 'remove_message'
      },
      {
        label: 'Remove Entire Thread',
        value: 'remove_thread'
      }
    ]
  }[value];
  const dialog = {
    callback_id: 'moderator_submit',
    title: 'Moderator Action',
    submit_label: 'Send',
    elements: [
      {
        hint: 'Choose moderator action...',
        label: 'Action',
        name: 'type',
        options: options,
        type: 'select',
        value: value
      },
      {
        hint: 'Explain why the moderators are taking action.',
        label: 'Message',
        name: 'message',
        placeholder: "Moderator's message...",
        type: 'textarea'
      },
      {
        hint: 'Do not alter this value.',
        label: 'Permalink',
        name: 'permalink',
        type: 'text',
        value: permalink
      },
      {
        hint: 'Do not alter this value.',
        label: 'Report Timestamp',
        name: 'report_ts',
        type: 'text',
        value: payload.original_message.ts
      }
    ]
  };
  console.log(`DIALOG ${JSON.stringify(dialog)}`);
  return slack.bot.dialog.open({
    trigger_id: payload.trigger_id,
    dialog: dialog
  });
}

/**
 * Post warning in private DM.
 *
 * @param {object} payload Slack payload.
 */
function moderatorSubmitPrivateDm(payload) {
  const channel = payload.submission.permalink.match(/archives\/(.*?)\//)[1];
  return getMessage(payload.submission.permalink).then((res) => {
    const options = {user: res.user};
    console.log(`OPEN DM ${JSON.stringify(options)}`);
    return slack.bot.im.open(options).then((im) => {
      const options = {
        channel: im.channel.id,
        text: payload.submission.message,
        attachments: [
          {
            color: 'danger',
            footer: `Posted in <#${channel}> by <@${res.user}>`,
            mrkdwn_in: ['text'],
            text: `<${payload.submission.permalink}|Permalink>\n${res.text}`,
            ts: res.ts
          }
        ]
      };
      console.log(`DM WARNING ${JSON.stringify(options)}`);
      return slack.bot.chat.postMessage(options);
    });
  }).then((res) => {
    const options = {
      channel: moderator_channel,
      count: 1,
      inclusive: true,
      latest: payload.submission.report_ts
    };
    console.log(`HISTORY ${JSON.stringify(options)}`);
    return slack.user.conversations.history(options);
  }).then((res) => {
    const msg = res.messages[0];
    const addendum = {
      color: 'warning',
      footer: `<@${payload.user.id}> warned user in DM`,
      text: payload.submission.message,
      ts: payload.action_ts
    };
    const options = {
      attachments: msg.attachments.concat([addendum]),
      channel: moderator_channel,
      text: msg.text,
      ts: payload.submission.report_ts
    };
    console.log(`ADDENDUM ${JSON.stringify(options)}`);
    return slack.bot.chat.update(options);
  });
}

/**
 * Post warning in thread.
 *
 * @param {object} payload Slack payload.
 */
function moderatorSubmitPostInThread(payload) {
  const channel = payload.submission.permalink.match(/archives\/(.*?)\//)[1];
  return getMessage(payload.submission.permalink).then((res) => {
    const options = {
      channel: channel,
      text: payload.submission.message,
      thread_ts: res.thread_ts || res.ts
    };
    console.log(`POST ${JSON.stringify(options)}`);
    return slack.bot.chat.postMessage(options);
  }).then((res) => {
    const options = {
      channel: moderator_channel,
      count: 1,
      inclusive: true,
      latest: payload.submission.report_ts
    };
    console.log(`HISTORY ${JSON.stringify(options)}`);
    return slack.user.conversations.history(options);
  }).then((res) => {
    const msg = res.messages[0];
    const addendum = {
      color: 'warning',
      footer: `<@${payload.user.id}> warned user in <#${channel}>`,
      text: payload.submission.message,
      ts: payload.action_ts
    };
    const options = {
      attachments: msg.attachments.concat([addendum]),
      channel: moderator_channel,
      text: msg.text,
      ts: payload.submission.report_ts
    };
    console.log(`ADDENDUM ${JSON.stringify(options)}`);
    return slack.bot.chat.update(options);
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

    // Open dialog to take moderator action
    else if (payload.callback_id === 'moderator_action') {
      const action = payload.actions[0].name;
      const permalink = payload.actions[0].value;

      // Warn user
      if (action === 'warn_action') {
        return moderatorAction(payload, permalink, 'private_dm');
      }

      // Remove message
      else if (action === 'remove_action') {
        return moderatorAction(payload, permalink, 'remove_message');
      }
    }

    // Post moderator action
    else if (payload.callback_id === 'moderator_submit') {

      // Warn user via DM
      if (payload.submission.type === 'private_dm') {
        return moderatorSubmitPrivateDm(payload);
      }

      // Warn user in thread
      else if (payload.submission.type === 'post_in_thread') {
        return moderatorSubmitPostInThread(payload);
      }
    }

    // Send DM to confirm report
    else if (payload.callback_id === 'report_message') {
      return reportMessage(payload);
    }

    // Open dialog to take report
    else if (payload.callback_id === 'compose_report') {
      return composeReport(payload);
    }

    // Post report to moderator channel
    else if (payload.callback_id === 'submit_report') {
      //return submitReport(payload);
    }

    // Contact reporter as slackbot
    else if (payload.callback_id === 'compose_response' || payload.callback_id === 'compose_mod_message') {
      return composeResponse(payload);
    }
  }).then((res) => {
    callback();
  }).catch((err) => {
    console.error(`ERROR ${JSON.stringify(err)}`);
    callback(err);
  });
}

exports.handler = handler;
