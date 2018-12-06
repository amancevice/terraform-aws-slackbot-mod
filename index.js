const moderator_channel = process.env.MODERATOR_CHANNEL;
const secret = process.env.AWS_SECRET;
const default_token = process.env.DEFAULT_TOKEN;

let payload, secrets, slack;

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
