import path from 'path';
import fs from 'fs-extra';
import rimraf from 'rimraf';

export default class FileUtils {

    static getStats(filePath) {
        try {
            filePath = path.resolve(filePath);
            if (fs.existsSync(filePath)) {
                return fs.statSync(filePath);
            } else {
                console.error(`No file found at ${filePath}`);
            }
        } catch (error) {
            console.error(`Could not get file stats for '${filePath}`);
        }
        return null;
    }
    
    static isDir(dirPath) {
        return fs.existsSync(dirPath) && fs.lstatSync(dirPath).isDirectory();
    }

    static getModifiedDate(filePath) {
        const stats = this.getStats(filePath);
        return stats ? stats.mtime : new Date(0);
    }

    static getSize(filePath) {
        const stats = this.getStats(filePath);
        return stats ? stats.size : 0;
    }

    /**
     * Returns the path of the most recently modified file in a dir.
     * Throws an error if the dir doesn't exist.
     * Returns null if the dir doesn't contain any files.
     * 
     * @returns {string?}
     */
    static getNewestFilePath(dirPath) {
        dirPath = path.resolve(dirPath);

        if (!fs.existsSync(dirPath)) {
            throw new Error(`No directory found at ${dirPath}`);
        }

        const files = fs.readdirSync(dirPath);
        let latestDate = new Date(0);
        let latestPath = null;
        for (const filePath of files) {
            try {
                const fullPath = path.join(dirPath, filePath);
                const stats = fs.statSync(fullPath);
                if (!stats.isFile()) {
                    continue;
                }
                const date = stats.mtime;
                if (date.getTime() > latestDate.getTime()) {
                    latestPath = fullPath;
                    latestDate = date;
                }
            } catch (error) {
                console.error(`Could not get file stats for '${filePath}'`);
            }
        };
        return latestPath;
    }
    
    /**
     * 
     * @param {JSON|string} json 
     * @param {path.ParsedPath} filePath 
     * @param {boolean} appendJsonExtension
     */
    static async saveJson(json, filePath, appendJsonExtension = true) {
      if (appendJsonExtension && !(filePath + '').endsWith('.json')) {
        filePath += '.json';
      }
      const jsonStr = (typeof json === 'string') ? json : JSON.stringify(json, null, 0);
      await fs.ensureFile(filePath);
      return fs.writeFile(filePath, jsonStr);
    }
    
    /**
     * Removes all files and subdirectories of `dirPath`, except for `exclude`.
     * @param {*} dirPath Any absolute directory path
     * @param {*} exclude Any glob patterns (e.g. `*.json|*.csv|my-important-folder`)
     */
    static removeFilesFromDir(dirPath, exclude = '') {
        let glob = dirPath;
        if (exclude) {
            glob += `/**/!(${exclude})`;
        }
        glob = path.resolve(glob);
        // fs.removeSync(glob); // fs-extra's remove doesn't work consistently with globs
        rimraf.sync(glob);
    }
    
    static getDateString(d = new Date()) {
        const dateStr = `${d.getFullYear()}-${this.pad(d.getMonth() + 1, 2)}-${this.pad(d.getDate() + 1, 2)}`;
        const timeStr = `${this.pad(d.getHours(), 2)}-${this.pad(d.getMinutes(), 2)}-${this.pad(d.getSeconds(), 2)}`;
        return `${dateStr}_${timeStr}`;
    }

    static pad(num, size) {
        let s = num + '';
        while (s.length < size) s = '0' + s;
        return s;
    }
    
    static async removeDirIfEmpty(dirPath) {
        if (!this.isDir(dirPath)) {
            return;
        }
        const isEmpty = await this.isDirEmpty(dirPath);
        if (isEmpty) {
            return fs.remove(dirPath);
        }
    }
    
    static async isDirEmpty(dirPath) {
        // @see https://stackoverflow.com/a/39218759/782899
        try {
            return await fs.promises.readdir(dirPath).then(files => {
                return files.length === 0;
            });
        } catch (err) {
            console.error(`Could check if dir is empty: '${dirPath}'`);
            return false;
        }
    }
    
    /**
    * Applies a suffix to a filename before the file extension
    * @param {string} filePath The full or relative path to a file
    * @returns {string} The same path, with the suffix applied before the file extension
    */
    static addFilenameSuffix(filePath, suffix = '') {
        const dirname = path.dirname(filePath);
        const filename = path.basename(filePath);
        const extension = path.extname(filePath);
        const filenameNoExt = filename.slice(0, -extension.length);
        return `${path.join(dirname, filenameNoExt)}${suffix}${extension}`;
    }

    // static async copyFile(sourcePath, destPath) {
    //     sourcePath = path.resolve(sourcePath);
    //     destPath = path.resolve(destPath);
    //     await fs.ensureDir(path.dirname(destPath));
    //     return fs.copyFile(sourcePath, destPath);
    // }

    // static copyFilesSync(sourceDir, destDir, overwrite = true) {
    //     try {
    //         fs.copySync(sourceDir, destDir, {overwrite: overwrite})
    //     } catch (error) {
    //         throw new Error(`Could not move files from '${sourceDir}' to '${destDir}' (${error.message})`);
    //     }
    // }

    // static removeDirSync(dirPath) {
    //     try {
    //         fs.removeSync(dirPath);
    //     } catch (error) {
    //         throw new Error(`Could not remove dir '${dirPath}' (${error.message})`);
    //     }
    // }

    // static makeDirSync(dirPath) {
    //     try {
    //         dirPath = path.resolve(dirPath);
    //         if (!fs.existsSync(dirPath)) {
    //             fs.mkdirpSync(dirPath);
    //         }
    //     } catch (error) {
    //         throw new Error(`Could not create dir for '${dirPath}' (${error.message})`);
    //     }
    // }
}