const express = require('express');
const app = express();
const port = 3000;
const fs = require('fs').promises;
const path = require('path');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');
const { fetchSheetData, placeOrder, upload,subscribeNow } = require('./service');
const bodyParser = require('body-parser');
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const SCOPES = ['https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets'];

  const TOKEN_PATH = path.join(process.cwd(), 'token.json');
  const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');


/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
  
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file comptible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *@return {Promise<OAuth2Client>}
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}


app.all('/api/online/:tenancyCode/:type/:name', async (req, res) => {
    const { tenancyCode, type, name } = req.params;
    try {
    const auth = await authorize();
    const { data, sheetId = null } = await fetchSheetData(tenancyCode, type, name,auth)
      let response = data;
      if (response.error) {
      res.json(response);
    } else {
      const galleryEndpoints = ["Gallery", "Menu", "Content", "Facebookpost", "Catalog", "OrderList", "PageHeaders", "Promotions"]
        switch (type) {
        case "SubscribeNow":
          if (req.method === "POST") {
            response = await subscribeNow(req.body.email, sheetId, auth);

          } else {
            response = { error: "Method Not Allowed" };
          }
          break;
        case "Upload":
          if (req.method === "POST") {
            response = await upload(req, response.folderId, auth);
          } else {
            response = { error: "Method Not Allowed" };
          }
          break;
        case "Order":
          if (req.method === "POST") {
            response = await placeOrder(req.body, sheetId, auth);
          } else {
            response = { error: "Method Not Allowed" };
          }
          break;
        case "Feedback":
          if (req.method === "POST") {

            response = await placeOrder(req.body, sheetId, auth);
          } else {
            response = { error: "Method Not Allowed" };
          }
          break;
        case "ContactUs":
          if (req.method === "POST") {
            response = await placeOrder(req.body, sheetId, auth);

          } else {
            response = { error: "Method Not Allowed" };
          }
          break;
        case "Location":
          if (req.method === "POST") {
            response = await placeOrder(req.body, sheetId, auth);
          
          } else {
            response = { error: "Method Not Allowed" };
          }
          break;
        default:
          if (!galleryEndpoints.includes(type) || req.method !== "GET") {
            response = { error: "Method Not Allowed" };
          }
      }
  
      res.json(response);
    }
}
    catch (error) {
        console.error(error);
        res.status(500).json({ error: "An error occurred while processing the request." });
      }
  });

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
  });