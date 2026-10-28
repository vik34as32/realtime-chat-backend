import mysql, { type RowDataPacket } from 'mysql2/promise';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function mysqlPort(): number {
  const raw = process.env.MYSQL_PORT ?? '3306';
  if (!/^\d+$/.test(raw)) {
    throw new Error('MYSQL_PORT must be an integer from 1 to 65535');
  }

  const port = Number(raw);
  if (port <= 0 || port > 65535) {
    throw new Error('MYSQL_PORT must be an integer from 1 to 65535');
  }

  return port;
}

const databaseName = databaseNameFromEnv();

export const pool = mysql.createPool({
  host: requiredEnv('MYSQL_HOST'),
  port: mysqlPort(),
  user: requiredEnv('MYSQL_USER'),
  password: process.env.MYSQL_PASSWORD ?? '',
  database: databaseName,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  timezone: 'Z',
});

export async function setupDatabase(): Promise<void> {
  const connection = await mysql.createConnection({
    host: requiredEnv('MYSQL_HOST'),
    port: mysqlPort(),
    user: requiredEnv('MYSQL_USER'),
    password: process.env.MYSQL_PASSWORD ?? '',
  });

  try {
    const [existingDatabases] = await connection.query<RowDataPacket[]>(
      'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
      [databaseName],
    );

    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );

    if (existingDatabases.length === 0) {
      console.log(`Database "${databaseName}" created successfully`);
    } else {
      console.log(`Database "${databaseName}" already exists`);
    }

    await connection.query(`USE \`${databaseName}\``);
    await createTables(connection);
    await connection.query('SELECT 1');
    console.log('Database connected successfully');
  } finally {
    await connection.end();
  }
}

async function createTables(connection: mysql.Connection): Promise<void> {
  const [existingTables] = await connection.query<RowDataPacket[]>(
    `SELECT TABLE_NAME
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME IN ('users', 'chats', 'chat_members')`,
    [databaseName],
  );

  await connection.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      profile_url VARCHAR(500) NOT NULL DEFAULT '',
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_users_email (email),
      UNIQUE KEY uq_users_phone (phone)
    ) ENGINE=InnoDB
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS chats (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      pair_key VARCHAR(64) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_chats_pair_key (pair_key),
      KEY idx_chats_updated_at (updated_at)
    ) ENGINE=InnoDB
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS chat_members (
      chat_id INT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (chat_id, user_id),
      KEY idx_chat_members_user_id (user_id),
      CONSTRAINT fk_chat_members_chat FOREIGN KEY (chat_id) REFERENCES chats (id),
      CONSTRAINT fk_chat_members_user FOREIGN KEY (user_id) REFERENCES users (id)
    ) ENGINE=InnoDB
  `);

  if (existingTables.length < 3) {
    console.log('Tables created successfully');
  } else {
    console.log('Tables already exist');
  }
}

function databaseNameFromEnv(): string {
  const name = requiredEnv('MYSQL_DATABASE');
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error('MYSQL_DATABASE must contain only letters, numbers, and underscores');
  }
  return name;
}
