import {sqliteTable,text,integer} from 'drizzle-orm/sqlite-core';
export const vault = sqliteTable('vault',{id:integer('id').primaryKey(),revision:integer('revision').notNull().default(0),payload:text('payload').notNull()});
export const imports = sqliteTable('imports',{id:text('id').primaryKey(),fingerprint:text('fingerprint').notNull(),created_at:text('created_at').notNull(),source:text('source').notNull(),status:text('status').notNull(),payload:text('payload').notNull()});
export const cards = sqliteTable('cards',{id:text('id').primaryKey(),payload:text('payload').notNull(),fetched_at:text('fetched_at').notNull()});
