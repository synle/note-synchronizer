# Note Synchronizer

Crawled Gmail Notes and push them to Google Drive

## Background:

- A lot of times people write notes by sending themselves an email. This background job is to filter out which emails are considered note and send those notes into google drive.

## Why this project?

- I find it extremely hard to look for contents / attachments from Gmail. It's sorted by chronologically orders. So if you want to look at all the attachments, or notes or links within the same UI, it's really hard to find those matches.
- Also non Google Doc attachments are counted toward my personal storage. So this project is to convert all of those non Google Docs to Google so that the message is not counted toward my personal storage. In a way helps me save spaces.

## Stack

- Node JS for backend jobs with Worker Threads APIs
- MySQL / Sqlite3 for datastore
- Gmail API
- Google Drive API

## Flow of data

- `FETCH_THREADS`: First pull in all the threadIds from Gmail (for me it was dated back all the way to 2005).
- `FETCH_RAW_CONTENT`: Fetch the raw content of the emails associated with the above threadIds
- `PARSE_EMAIL`: Parse the email accordingly, strip out unwanted tags. If the emails have simply links to a post, then curl that URL for the content of the link
- `UPLOAD_EMAIL` For each of the emails, run a rule condition. If passed will send the emails and associated attachments to Google Drive for storage. At the moment, the buckets are grouped by the sender email address. Note that the original email will be converted to docx before uploading to Google Drive.

## How to run

- Move .env_backup to .env. Modify the content accordingly for SQL Connection
- Then run `npm test`. Follow the instruction and paste the link and complete the auth process to retrieve the Google API token.
- Then run the jobs
  - `npm run job1`
  - `npm run job2`
  - `npm run job3`
  - `npm run job4`

## Benchmark for parsing

Before I parallize and use worker thread, I have a single thread that runs all the jobs with non blocking promises. But due to the nature of single thread in JS, the whole task is super slow. For my use case, I have about 60,000 threads of emails and about 15,000 attachments over the course of 15+ years using Gmail dated back to 2005.

With single process / single thread node js, it takes about 15 mins to do all the work: fetch the thread list, fetch the thread raw contents, parsing and sending the file to GMail.

With multi processes of about 8 concurrent workers, the process takes about 6 hours. So it's about 2+ times faster than single thread. The bottleneck for my local setup is database engine. So if I would to scale the database out with more memory, and allow more concurrent connections to MySQL database, this benchmark should improve dramatically.

## Lessons Learned

- It's painfully hard to parallelize Node JS processes. If you want to write an intensive program, go with something else. Don't choose node. It's not built for it. Pick something performant like C or Java or even Go. Not to say it's not doable, but the code is very hard to manage.

- Initially I started using SQLITE for its dependencies free setup. It works well for single processes use case. But problems of file locking with SQLITE quickly arises when I introduce concurrent workers. So then I switched to MySQL as the database engine. This choice seems to help with the concurrent loads.

- Almost all of Google API's use base64 encoded content for data including Gmail messages, Gmail Attachments and Google Drive API's. Details of how to deal with Google API nuances should be described in this doc, refer to the description of Gmail APIs

## Gmail APIs

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
import fs from 'fs';

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

#### Requeue the task

##### Restart All Tasks

```
DELETE FROM emails;
DELETE FROM attachments;

UPDATE `threads`
SET status='PENDING_CRAWL',
  processedDate=null,
  totalMessages=null;
```

```
UPDATE `emails`
SET status='PENDING_PARSE_EMAIL'
WHERE status != 'PENDING_PARSE_EMAIL' AND status != 'SUCCESS';

UPDATE `threads`
SET status='PENDING_CRAWL'
WHERE status != 'PENDING_CRAWL' AND status != 'SUCCESS';
```

```
UPDATE `emails`
SET status='PENDING_SYNC_TO_GDRIVE'
WHERE status != 'PENDING_SYNC_TO_GDRIVE' AND status != 'SUCCESS' AND status != 'PENDING_PARSE_EMAIL';
```

#### Get job status stats

```
SELECT status, count(1)
FROM `threads` GROUP by status;

SELECT status, count(1)
FROM `emails` GROUP by status;
```

```
-- if table size is too big, we can use this to get the total count instead
Explain SELECT COUNT(1) FROM `emails`
```

#### Rename MySQL table

```
ALTER TABLE threads
  RENAME TO threads2;

INSERT INTO threads
SELECT * FROM threads2
```

### Useful tips

#### Tail in Windows

```
Get-Content -Wait .\logs\log_combined.data
```

#### MySQL Sequelize timeout issues

```
{
  ...
  dialectOptions: {
    connectTimeout: 120000,
  },
}
```

#### SQL Tuning Tip

##### Set bigger pool size

```
SET GLOBAL innodb_buffer_pool_size=402653184;
SET GLOBAL connect_timeout=28800;
SET GLOBAL mysqlx_read_timeout=28800;
SET GLOBAL mysqlx_wait_timeout=28800;
SET GLOBAL interactive_timeout=28800;
SET GLOBAL wait_timeout=28800;
```

##### To view other settings

```
show variables LIKE '%innodb_buffer%';
```

##### Sample config for timeout

```
+-----------------------------------+----------+
| Variable_name                     | Value    |
+-----------------------------------+----------+
| connect_timeout                   | 10       |
| delayed_insert_timeout            | 300      |
| have_statement_timeout            | YES      |
| innodb_flush_log_at_timeout       | 1        |
| innodb_lock_wait_timeout          | 50       |
| innodb_rollback_on_timeout        | OFF      |
| interactive_timeout               | 28800    |
| lock_wait_timeout                 | 31536000 |
| mysqlx_connect_timeout            | 30       |
| mysqlx_idle_worker_thread_timeout | 60       |
| mysqlx_interactive_timeout        | 28800    |
| mysqlx_port_open_timeout          | 0        |
| mysqlx_read_timeout               | 30       |
| mysqlx_wait_timeout               | 28800    |
| mysqlx_write_timeout              | 60       |
| net_read_timeout                  | 30       |
| net_write_timeout                 | 60       |
| rpl_stop_slave_timeout            | 31536000 |
| slave_net_timeout                 | 60       |
| wait_timeout                      | 28800    |
+-----------------------------------+----------+
```
