const http = require("http");
const fetch = require("node-fetch");
const { parse } = require("url");
const puppeteer = require("puppeteer");
const dotenv = require("dotenv");
const CryptoJS = require("crypto-js");

dotenv.config(); // Load environment variables from .env

const secretKey = process.env.SECRET_KEY; // Use API_KEY from .env

const encryptedclientId = "U2FsdGVkX1/NvoGhZPkYjP2FcrUErmI/OFS5HOH3OMDdj64Agm1nUejs0iyKh4OySL6xYyzm291i2kMGS5gWZQ==";
const encryptedclientSecret = "U2FsdGVkX19fg2Z9UgfmKxsQi7FXA0hYhXWtzwx2UbHnQGdEROEFryy05VNnpoK2mfBJHeMVkPLxAwO05kBbFA==";
const redirectUri = "http://localhost:3000/callback";

function decryptText(encryptedText, key) {
  const bytes = CryptoJS.AES.decrypt(encryptedText, key);
  return bytes.toString(CryptoJS.enc.Utf8);
}

const clientId = decryptText(encryptedclientId, secretKey);
const clientSecret = decryptText(encryptedclientSecret, secretKey);

let browser;

const getAccessToken = async (authorizationCode) => {
  const response = await fetch(
    "https://launchpad.37signals.com/authorization/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "web_server",
        client_id: clientId,
        client_secret: clientSecret,
        code: authorizationCode,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(
      `Failed to get access token: ${response.statusText}, ${JSON.stringify(
        errorData
      )}`
    );
  }

  const data = await response.json();
  console.log(data);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  };
};

const openAuthUrl = async () => {
  const authUrl = `https://launchpad.37signals.com/authorization/new?type=web_server&client_id=${clientId}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}`;

  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    slowMo: 50,
  });

  const page = await browser.newPage();
  await page.goto(authUrl);

  await page.waitForSelector("#username");
  await page.type("#username", "megha.garg@comprotechnologies.com");

  await page.click('[name="button"]');
  await page.waitForSelector("[data-role=password_container]");

  const encryptedPassword = "U2FsdGVkX19jzRJrysMDUukki0IzbCEOSOqu+H1197Y=";
  const password = decryptText(encryptedPassword, secretKey);

  await page.waitForSelector("#password");
  await page.type("#password", password);
  await page.keyboard.press("Enter");

  await page.waitForSelector('button[type="submit"]');
  await page.click('button[type="submit"]');
};

const startServer = () => {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const parsedUrl = parse(req.url, true);

      if (parsedUrl.pathname === "/callback" && parsedUrl.query.code) {
        const authorizationCode = parsedUrl.query.code;
        console.log("Authorization code:", authorizationCode);

        try {
          const { access_token, refresh_token } = await getAccessToken(
            authorizationCode
          );

          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end(
            `Access token: ${access_token}\nRefresh token: ${refresh_token}`
          );

          resolve(access_token);

          await server.close(() => {
            console.log("Server closed.");
            if (browser) {
              browser.close().then(() => console.log("Browser closed."));
            }
          });
        } catch (error) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end(`Error: ${error.message}`);
          reject(error);
        }
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
      }
    });

    const PORT = 3000;
    server.listen(PORT, async () => {
      console.log(`Server is running at http://localhost:${PORT}`);
      await openAuthUrl();
    });
  });
};

module.exports = { startServer };
