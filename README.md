# Note Synchronizer

Crawled Gmail Notes and push them to Google Drive

## Background:

- A lot of times people write notes by sending themselves an email. This background job is to filter out which emails are considered note and send those notes into google drive.

## Stack

- Node JS for backend jobs
- Sqlite3 for datastore
- Gmail API
- Google Drive API

## Lessons Learned

Almost all of Google API's use base64 encoded content for data including Gmail messages, Gmail Attachments and Google Drive API's. Below are some sample code in Node that deals with it.

### Dependencies in Node

```
npm install --save js-base64 googleapis
```

### Parse Gmail Content

```
const { Base64 } = require("js-base64");

// get the body data
// const bodyData = should be one of this <message.payload.parts[].body.data> or <message.payload.body.data>

Base64.decode(
  (bodyData || "").replace(/-/g, "+").replace(/_/g, "/")
).trim()
```

### Gmail Content Parts

Sometimes Gmail Email can have nested parts. I wrote the following calls to flatten the nested parts iteratively

```
function _flattenGmailPayloadParts(initialParts) {
  const res = [];

  let stack = [initialParts];

  while (stack.length > 0) {
    const target = stack.pop();
    const { parts, ...rest } = target;
    res.push(rest);

    if (parts && parts.length > 0) {
      stack = [...stack, ...parts];
    }
  }

  return res;
}

const flattenParts =_flattenGmailPayloadParts(message.payload);
```

### Download Gmail attachment

```
// const attachmentResponse = <result from gmail.users.messages.attachments.get>.data.data

const data = attachmentResponse.replace(/-/g, "+").replace(/_/g, "/");

fs.writeFileSync('./newFilePath.txt', data, "base64", function (err) {
  console.log(err);
});
```

### Upload Files to Google Drive

```
const fs = require("fs");

// source meta data
const media = {
  mimeType,
  body: fs.createReadStream('./localPath.txt'),
};

// destination meta data
const resource = {
  name,
  parents: [parentFolderId],
  mimeType: mimeTypeToUse,
};

drive.files.create(
  {
    resource,
    media,
    fields: "id",
  }
)
```

#### Mimetype Mapping for Free Space in Google Drive

Some files when stored in Google Docs, Google Sheets or Google Slides are not counted toward your Google Drive space. Plus it has better support from Google. Below is the mapping

```
application/vnd.google-apps.document (Google Docs)
    text/plain
    text/xml
    application/xml
    application/json
    application/vnd.openxmlformats-officedocument.wordprocessingml.document

application/vnd.google-apps.spreadsheet (Google Sheets)
    text/csv
    application/vnd.ms-excel

application/vnd.google-apps.presentation (Google Slides)
    application/vnd.ms-powerpoint
```

### SQL Queries

#### Show list of messages and their timestamp

```
SELECT id, threadId,  subject, body, datetime(date / 1000, 'unixepoch') as time FROM "emails" ORDER BY date DESC LIMIT 20
```

#### Reset processed and restart the full load

```
UPDATE "threads" SET processedDate = null
```
