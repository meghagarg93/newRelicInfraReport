const fs = require("fs");
const path = require("path");
const axios = require("axios");
const moment = require("moment");
const CryptoJS = require("crypto-js");
const dotenv = require("dotenv");
const data = require("./params.js");
const { startServer } = require("./startserver.js");

dotenv.config();
const secretKey = process.env.SECRET_KEY;

let access_token = data.access_token;
let creation_date = data.day_created;

function saveParams() {
  const dataString = `module.exports = ${JSON.stringify(data, null, 2)};`;
  fs.writeFileSync("./params.js", dataString, "utf8");
}

async function checkAndUpdateExpiresIn() {
  const curr = moment();
  const created = moment(creation_date);
  if (curr.diff(created, "days") > 10 || curr.month() !== created.month()) {
    try {
      const accessToken = await startServer();
      const encryptedaccessToken = CryptoJS.AES.encrypt(accessToken, secretKey).toString();
      data.access_token = encryptedaccessToken;
      data.day_created = curr.format("YYYY-MM-DD");
      saveParams();
    } catch (err) {
      console.error("OAuth renewal failed:", err);
    }
  } else {
    console.log("✅ Basecamp token valid");
  }
}

async function uploadImage(filePath) {
  try {
    const fileData = fs.readFileSync(filePath);
    const url = "https://3.basecampapi.com/4489886/attachments.json?name=chart.png";

    const response = await axios.post(url, fileData, {
      headers: {
        Authorization: `Bearer ${CryptoJS.AES.decrypt(access_token, secretKey).toString(CryptoJS.enc.Utf8)}`,
        "Content-Type": "image/png",
      },
    });

    return response.data.attachable_sgid;
  } catch (error) {
    console.error(`❌ Error uploading image ${filePath}:`, error.message);
    return null;
  }
}

async function postToBasecamp(service, env) {
    const projectId = data.basecampProjects[env];
  const threadId = data.basecampThreads[service];
  if (!threadId) {
    console.warn(`⚠️ No Basecamp thread mapping found for ${service}`);
    return;
  }

  const cpuPath = `./outputs/${env}/${service}_${env}_cpuutilization_chart.png`;
  const memPath = `./outputs/${env}/${service}_${env}_memoryutilization_chart.png`;
  const reportPath = `./outputs/${env}/report_${service}.txt`;

  const cpuSGID = await uploadImage(cpuPath);
  const memSGID = await uploadImage(memPath);

  if (!cpuSGID || !memSGID) {
    console.warn(`⚠️ One or more attachments failed for ${service}`);
    return;
  }

  // Replace chart links in the report
  let content = fs.readFileSync(reportPath, "utf-8");
  content = content.replace("<<cpu_chart_link>>", cpuSGID);
  content = content.replace("<<memory_chart_link>>", memSGID);
  fs.writeFileSync(reportPath, content);

  const url = `https://3.basecampapi.com/4489886/buckets/${projectId}/recordings/${threadId}/comments.json`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${CryptoJS.AES.decrypt(access_token, secretKey).toString(CryptoJS.enc.Utf8)}`
  };

  try {
    const body = { content };
    await axios.post(url, body, { headers });
    console.log(`📬 Posted to Basecamp thread for ${service}`);
  } catch (error) {
    console.error(`❌ Failed to post Basecamp comment for ${service}:`, error.message);
  }
}

module.exports = {
  checkAndUpdateExpiresIn,
  postToBasecamp
};
