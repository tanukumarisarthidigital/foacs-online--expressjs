'use strict';

const { google } = require('googleapis');
const fs = require('fs');
const os = require('os');
const path = require('path');
const stream = require('stream');
const util = require('util');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

const cache =new Map();
async function fetchDataWithCaching(key, fetchDataFunction) {
  const cachedData = cache.get(key);
  if (cachedData) {
    return JSON.parse(cachedData);
  } else {
    const data = await fetchDataFunction();
    cache.set(key, JSON.stringify(data));
    return data;
  }
}

async function loadSavedCredentialsIfExist() {
  try {
    const content = fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

async function fetchSheetData(tenancyCode, type, name, oauth2Client) {
  const cacheKey = `fetchSheetData-${tenancyCode}-${type}-${name}`;
  return await fetchDataWithCaching(cacheKey, async () => {
    let tokenData = await loadSavedCredentialsIfExist();
    if (tokenData) {
      oauth2Client.setCredentials({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token
      });
    }

    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    const content = fs.readFileSync(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
   const spreadsheetId = key.SPREADSHEET_ID;
    const searchRange = `Sheet1!A:A`;
    const nameSearchRange = `Sheet1!A:A`;
    const typeSearchRange = `Sheet1!B:B`;
    const response = await getData(spreadsheetId, searchRange, oauth2Client)
    if (response.data.error) {
      return response
    }

    let rowIndex = null;
    const rows = response.data.values;

    if (rows) {
      for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] === tenancyCode) {
          rowIndex = i + 1;
          break;
        }
      }
    }

    // If the tenancyCode is found, fetch the entire row
    if (rowIndex !== null) {
      const rowRange = `Sheet1!A${rowIndex}:Z${rowIndex}`;
      const rowResponse = await sheets.spreadsheets.values.get({ spreadsheetId: spreadsheetId, range: rowRange });
      const newSheetLink = rowResponse.data.values[0][2]
      const newSheetId = newSheetLink.split('/')[5]
      const nameRows = (await getData(newSheetId, nameSearchRange, oauth2Client)).data
      if (nameRows.error) {
        return { data: nameRows }
      }
      const typeRows = (await getData(newSheetId, typeSearchRange, oauth2Client)).data.values
      rowIndex = null;
      let typePresent = false
      if (nameRows.values && typeRows) {
        for (let i = 0; i < nameRows.values.length; i++) {
          if (typeRows[i][0] === type) {
            typePresent = true
            if (nameRows.values[i][0] === name) {
              rowIndex = i + 1;
              break;
            }
          }
        }
      }
      if (rowIndex) {
        const newRange = `Sheet1!A${rowIndex}:Z${rowIndex}`; // Fetch up to column Z, adjust as needed
        const newResponse = await getData(newSheetId, newRange, oauth2Client)
        if (newResponse.data.error) {
          return newResponse
        }
        if (type === "Upload") {
          const folderLink = newResponse.data.values[0][2]
          const folderId = folderLink.split('/')[5]
          return { data: { folderId: folderId }, sheetId: null }
        } else {
          const finalSheetLink = newResponse.data.values[0][2]
          const finalSheetId = finalSheetLink.split('/')[5]
          const finalResponse = await getData(finalSheetId, 'Sheet1!A1:Z100', oauth2Client)
          if (finalResponse.data.error) {
            return finalResponse
          }
          let ret = []
          finalResponse.data.values.slice(1, finalResponse.data.values.length).forEach((item) => {
            let itemObj = {}
            item.forEach((value, i) => {
              itemObj[finalResponse.data.values[0][i]] = value
            })
            ret.push(itemObj)
          })
          return { data: ret, sheetId: finalSheetId }
        }
      } else {
        if (typePresent) {
          return { data: { error: `Attribute ${name} not found in ${type} with tenancy code ${tenancyCode}` } }
        }
        return { data: { error: `${type} not defined for tenancy code ${tenancyCode}` } }
      }
    } else {
      return { data: { error: `Tenancy code not found` } }
    }
  });
}
      
async function getData(sheetId, range, oauth2Client) {
  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: range });
    if (response === undefined) {
      return { data: { error: `Invalid Credentials - Navigate To ${url}/api/generate-auth-url` } }
    }
    return response
  } catch (err) {
    if (err.message === 'Invalid Credentials' || err.message === "Unable to parse range: Sheet1!A:A") {
      return { data: { error: `Invalid Credentials - Navigate To ${url}/api/generate-auth-url` } }
    } else {
      return { data: { error: err.message } }
    }
  }
}
async function subscribeNow(email, sheetId, oauth2Client) {
  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'Sheet1',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    resource: {
      values: [[new Date(), email]],
    }
  })
  return { success: true }
}

async function placeOrder(data, sheetId, oauth2Client) {
  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
  const header = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Sheet1!A1:Z1' })
  const newRow = header.data.values[0].map((key) => {
    if (data[key]) {
      if (Array.isArray(data[key])) {
        if (data[key][0]) {
          const val = data[key][0]
          data[key].shift()
          return val
        } else {
          return ' '
        }
      } else {
        return data[key]
      }
    } else {
      return ' '
    }
  })
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'Sheet1',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    resource: {
      values: [newRow],
    }
  })
  return { success: true }
}
async function upload(req, folderId, oauth2Client) {
  const pipeline = util.promisify(stream.pipeline)
  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const tempFilePath = path.join(os.tmpdir(), 'tempImage');
  const writeStream = fs.createWriteStream(tempFilePath);
  await pipeline(req, writeStream)
  const response = await drive.files.create({
    requestBody: {
      name: req.headers['content-type'].split('/')[1].toUpperCase() + '_' + Date.now(),
      mimeType: req.headers['content-type'],
      parents: [folderId]
    },
    media: {
      mimeType: 'image/jpeg',
      body: fs.createReadStream(tempFilePath)
    },
    supportsAllDrives: true
  })
  fs.unlinkSync(tempFilePath)
  return { success: true, id: req.headers['content-type'].split('/')[1].toUpperCase() + '_' + Date.now() }
}
  module.exports = {
    upload,
    placeOrder,
    fetchSheetData,
    subscribeNow
   
  };