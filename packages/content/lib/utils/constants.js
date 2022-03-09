import chalk from 'chalk';

class Constants {
  static get IMAGE_REGEX() {
    return /.+(\.jpg|\.jpeg|\.png)/gi;
  }
  static get VIDEO_REGEX() {
    return /.+(\.avi|\.mov|\.mp4|\.mpg|\.mpeg)/gi;
  }
  static get MEDIA_REGEX() {
    return new RegExp(`(${Constants.IMAGE_REGEX.source})|(${Constants.VIDEO_REGEX.source})`);
  }
  static get DOWNLOAD_PATH_TOKEN() {
    return '%DOWNLOAD_PATH%';
  }
  static get TIMESTAMP_TOKEN() {
    return '%TIMESTAMP%';
  }
  
  static getProgressFormat(prefix = '', tasksLabel = 'files') {
    prefix = prefix || 'Processing';
    return `${prefix} ${chalk.cyan('{value}/{total}')} ${tasksLabel}: ${chalk.cyan('{bar}')}`;
 }
}

export default Constants;
