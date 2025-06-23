const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const CryptoJS = require("crypto-js");
const dotenv = require("dotenv");

dotenv.config();
const secretKey = process.env.SECRET_KEY;

module.exports = function sendEmail(fail, ENV, appName) {
  const password = CryptoJS.AES.decrypt(
    "U2FsdGVkX1+eOet6PMhEyu+sZHVYS0o3IGvhJxmV9V23E0dXH/7rYFpkKH9SgR+p",
    secretKey
  ).toString(CryptoJS.enc.Utf8);

  const dirPath = path.join(__dirname, "outputs", ENV);

  if (fail === 0) {
    const textFile = path.join(dirPath, `report_${appName}.txt`);
    const textData = fs.existsSync(textFile)
      ? fs.readFileSync(textFile, "utf8")
      : `⚠️ Report missing for ${appName}`;

    const attachments = fs.readdirSync(dirPath)
      .filter(file => file.startsWith(`${appName}_${ENV}`) && file.endsWith(".png"))
      .map(file => ({
        filename: file,
        path: path.join(dirPath, file),
      }));

    if (fs.existsSync(textFile)) {
      attachments.push({
        filename: `report_${appName}.txt`,
        path: textFile,
      });
    }

    const transport = nodemailer.createTransport({
      service: "gmail",
      port: 2525,
      auth: {
        user: "cupteamtool@gmail.com",
        pass: password,
      },
    });

    const mailOptions = {
      from: "cupteamtool@gmail.com",
      to: ["megha.garg@comprotechnologies.com"],
      subject: `New Relic Usage Report - ${ENV.toUpperCase()} - ${appName}`,
      html: `<pre>${textData}</pre>`,
      attachments,
    };

    return new Promise((resolve, reject) => {
      transport.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error(`❌ Email send error for ${appName}:`, error);
          reject(error);
        } else {
          console.log(`📨 Email sent for ${appName}:`, info.response);
          resolve(info.response);
        }
      });
    });

  } else if (fail === 1) {
    const textData = `Failure: Maximum retry reached for ${appName} in ${ENV}`;
    const transport = nodemailer.createTransport({
      service: "gmail",
      port: 2525,
      auth: {
        user: "cupteamtool@gmail.com",
        pass: password,
      },
    });

    const mailOptions = {
      from: "cupteamtool@gmail.com",
      to: ["megha.garg@comprotechnologies.com"],
      subject: `New Relic Report Failed - ${appName} [${ENV}]`,
      html: `<pre>${textData}</pre>`,
    };

    return new Promise((resolve, reject) => {
      transport.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error(`📧 Failure Email send error for ${appName}:`, error);
          reject(error);
        } else {
          console.log(`📨 Failure Email sent for ${appName}:`, info.response);
          resolve(info.response);
        }
      });
    });
  }
};
