import base from "./playwright.config";
export default { ...base, testDir: ".kb-tmp", workers: 1 };
