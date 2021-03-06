// @ts-nocheck
import { table, attribute, index } from 'sequelize-typescript-decorators';

import { DataTypes, Model } from 'sequelize';

@table('folders', {
  timestamps: true,
})
export class Folder extends Model {
  @attribute(Folder, {
    allowNull: false,
    primaryKey: true,
    unique: true,
  })
  folderName!: string;

  @attribute(Folder)
  driveFileId!: string;
}

/**
 * threads
 */
@table('threads', {
  timestamps: true,
})
export class Thread extends Model {
  @attribute(Thread, {
    allowNull: false,
    primaryKey: true,
    unique: true,
    type: DataTypes.STRING(20),
  })
  threadId!: string;

  @attribute(Thread, { type: DataTypes.BIGINT })
  processedDate!: number;

  @attribute(Thread, { type: DataTypes.INTEGER })
  duration!: number;

  @attribute(Thread, { type: DataTypes.BIGINT })
  totalMessages!: number;

  @attribute(Thread, { allowNull: false })
  historyId!: string;

  @attribute(Thread, { allowNull: false })
  snippet!: string;
}

/**
 * this is the email details
 */
@table('emails', {
  timestamps: true,
})
@index([
  {
    unique: false,
    fields: ['threadId'],
  },
  {
    unique: false,
    fields: ['from'],
  },
  {
    unique: false,
    fields: ['subject'],
  },
  {
    unique: false,
    fields: ['labelIds'],
  },
  {
    unique: false,
    fields: ['driveFileId'],
  },
])
export class Email extends Model {
  @attribute(Email, {
    allowNull: false,
    primaryKey: true,
    unique: true,
    type: DataTypes.STRING(20),
  })
  id!: string;

  @attribute(Email, { allowNull: false, type: DataTypes.STRING(20) })
  threadId!: string;

  @attribute(Email)
  driveFileId!: string;

  @attribute(Email)
  from!: string;

  @attribute(Email, { type: DataTypes.TEXT })
  to!: string;

  @attribute(Email, { type: DataTypes.TEXT })
  bcc!: string;

  @attribute(Email)
  subject!: string;

  @attribute(Email)
  rawSubject!: string;

  @attribute(Email, { type: 'MEDIUMTEXT' })
  body!: string;

  @attribute(Email, { type: 'MEDIUMTEXT' })
  rawBody!: string;

  @attribute(Email, { type: DataTypes.BIGINT })
  date!: number;

  @attribute(Email, { type: DataTypes.STRING(700) })
  labelIds!: string;

  @attribute(Email, { type: 'MEDIUMTEXT', allowNull: false })
  rawApiResponse!: string;

  @attribute(Email, {
    type: DataTypes.TINYINT(1),
    allowNull: false,
    defaultValue: 0,
  })
  isEmailSentByMe!: boolean;

  @attribute(Email, {
    type: DataTypes.TINYINT(1),
    allowNull: false,
    defaultValue: 0,
  })
  isChat!: boolean;

  @attribute(Email, {
    type: DataTypes.TINYINT(1),
    allowNull: false,
    defaultValue: 0,
  })
  isEmail!: boolean;

  @attribute(Email, {
    type: DataTypes.TINYINT(1),
    allowNull: false,
    defaultValue: 0,
  })
  starred!: boolean;

  // @attribute(Email, { type: DataTypes.TEXT })
  // headers!: string;

  static transform(email) {
    email.isEmailSentByMe = !!email.isEmailSentByMe;
    email.isChat = !!email.isChat;
    email.isEmail = !!email.isEmail;
    email.starred = !!email.starred;
    return email;
  }
}

/**
 * this is where we store all the email attachments
 */
@table('attachments', {
  timestamps: true,
})
@index([
  {
    unique: false,
    fields: ['messageId'],
  },
  {
    unique: false,
    fields: ['threadId'],
  },
  {
    unique: false,
    fields: ['fileName'],
  },
  {
    unique: true,
    fields: ['path'],
  },
  {
    unique: false,
    fields: ['inline'],
  },
  {
    unique: false,
    fields: ['size'],
  },
  {
    unique: false,
    fields: ['driveFileId'],
  },
])
export class Attachment extends Model {
  @attribute(Attachment, {
    allowNull: false,
    allowNull: false,
    primaryKey: true,
  })
  path!: string;

  @attribute(Attachment, {
    allowNull: false,
    unique: true,
    type: DataTypes.STRING(750),
  })
  id!: string;

  @attribute(Attachment, { allowNull: false, type: DataTypes.STRING(20) })
  threadId!: string;

  @attribute(Attachment)
  driveFileId!: string;

  @attribute(Attachment, { allowNull: false })
  messageId!: string;

  @attribute(Attachment, { allowNull: false })
  mimeType!: string;

  @attribute(Attachment, { allowNull: false })
  fileName!: string;

  @attribute(Attachment, { type: DataTypes.INTEGER, allowNull: false })
  size!: number;

  @attribute(Attachment, { type: DataTypes.TINYINT(1), allowNull: false })
  inline!: number;

  // @attribute(Attachment, { type: DataTypes.TEXT, allowNull: false })
  // headers!: string;
}

export default {
  Attachment,
  Email,
  Thread,
  Folder,
};
