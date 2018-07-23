const moderator_channel = process.env.MODERATOR_CHANNEL;

let secrets, slack;

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
      slack = new WebClient(secrets.WORKSPACE_TOKEN);
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
  // Log it
  console.log(`EVENT ${JSON.stringify(event)}`);

  // Map it
  let payload;
  event.Records.map((record) => {
    // Parse it
    payload = JSON.parse(Buffer.from(record.Sns.Message, 'base64').toString());
  });
  // Send it
  console.log(`PAYLOAD ${JSON.stringify(payload)}`);
  return payload;
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
  const ts = match.slice(2, 4).join('.');

  if (permalink.match(/thread_ts=/)) {
    const thread_ts = permalink.match(/thread_ts=(\d{10}\.\d{6})/)[1];
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
      console.log(`MESSAGE ${JSON.stringify(res.messages[0])}`);
      return res.messages[0];
    });
  }
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
      return slack.dialog.open({
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
    const report = {
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
    console.log(`REPORT ${JSON.stringify(report)}`);
    return slack.chat.postMessage(report);
  }).then((res) => {
    const receipt = {
      channel: payload.user.id,
      text: 'We have received your report',
      attachments: [
        {
          color: 'warning',
          footer: `Reported by <@${payload.user.id}>`,
          text: payload.submission.reason,
          ts: payload.action_ts
        }
      ]
    };
    console.log(`RECEIPT ${JSON.stringify(receipt)}`);
    return slack.chat.postMessage(receipt);
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
  return slack.dialog.open({
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
    const options = {
      channel: res.user,
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
    console.log(`DM ${JSON.stringify(options)}`);
    return slack.chat.postMessage(options);
  }).then((res) => {
    const options = {
      channel: moderator_channel,
      count: 1,
      inclusive: true,
      latest: payload.submission.report_ts
    };
    console.log(`HISTORY ${JSON.stringify(options)}`);
    return slack.conversations.history(options);
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
    return slack.chat.update(options);
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
    return slack.chat.postMessage(options);
  }).then((res) => {
    const options = {
      channel: moderator_channel,
      count: 1,
      inclusive: true,
      latest: payload.submission.report_ts
    };
    console.log(`HISTORY ${JSON.stringify(options)}`);
    return slack.conversations.history(options);
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
    return slack.chat.update(options);
  });
}

/**
 * Remove message.
 *
 * @param {object} payload Slack payload.
 */
function moderatorSubmitRemoveMessage(payload) {
  const channel = payload.submission.permalink.match(/archives\/(.*?)\//)[1];
  return getMessage(payload.submission.permalink).then((msg) => {
    const options = {channel: channel, ts: msg.ts};
    console.log(`REMOVE ${JSON.stringify(options)}`);
    return slack.chat.delete(options);
  }).then((res) => {
    console.log(`RES ${JSON.stringify(res)}`);
    const options = {
      channel: channel,
      text: 'A message was removed',
      thread_ts: undefined
    };
    console.log(`POST ${JSON.stringify(options)}`);
    return slack.chat.postMessage(options);
  });
}

/**
 * Remove message.
 *
 * @param {object} payload Slack payload.
 */
function moderatorSubmitRemoveThread(payload) {
  return getMessage(payload.submission.permalink).then((msg) => {
    const channel = payload.submission.permalink.match(/archives\/(.*?)\//)[1];
    const options = {
      channel: channel,
      text: `_${payload.submission.message}_`,
      ts: msg.thread_ts
    };

    return slack.conversations.replies(options).then((res) => {
      return Promise.all(
        res.messages.reverse().map((rep) => {
          options.ts = rep.ts;
          console.log(`REMOVE ${JSON.stringify(options)}`);
          slack.chat.update(options);
        })
      );
    }).then((res) => {
      options.ts = msg.ts;
      console.log(`REMOVE ${JSON.stringify(options)}`);
      return slack.chat.update(options);
    });
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
  return getSecrets().then(getSlack).then((res) => {
    const payload = getPayload(event);
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

      // Remove message
      else if (payload.submission.type === 'remove_message') {
        return moderatorSubmitRemoveMessage(payload);
      }

      // Remove thread
      else if (payload.submission.type === 'remove_thread') {
        return moderatorSubmitRemoveThread(payload);
      }
    }
  }).then((res) => {
    callback(null, res);
  }).catch((err) => {
    console.error(`ERROR ${err}`);
    callback(err);
  });
}

exports.handler = handler;
