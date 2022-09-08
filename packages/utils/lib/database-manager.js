import { Low, JSONFile } from 'lowdb';
import fs from "fs-extra";
import path from "path";

export default class DatabaseManager {

  _collections = {};

  /** @type {DatabaseManager} */
	static _instance = null;

	/** @returns {DatabaseManager} */
	static getInstance() {
		if (this._instance === null) {
			this._instance = new DatabaseManager();
		}
		return this._instance;
  }


  constructor() {

  }

  async getCollection(collection, defaultData = {}) {

    if (this._collections[collection]) {
      return this._collections[collection];
    }

    const dir = path.resolve(process.env.DB_DIR);
    const file = path.join(dir, collection+ ".json");

    if (!fs.existsSync(file)) {
      fs.ensureDirSync(dir);
      fs.writeJson(file, defaultData, { spaces: 2 });
    }
    const adapter = new JSONFile(file);
    const db = new Low(adapter);

    await db.read();

    db.data ||= defaultData;

    this._collections[collection] = db;

    return this._collections[collection];
  }

  async saveCollection(collection) {
    if (this._collections[collection]) {
      await this._collections[collection].write();
    }
  }

  // TODO: on shutdown, should we write everything? Or write to backups?

}
