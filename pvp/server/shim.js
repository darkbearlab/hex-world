// 機器人的工具（ASH 的 clear-bot、tools/pvp/match.mjs）載入時會讀 process.env、process.argv；Worker 沒有 process。
// 要在任何遊戲模組之前載入（worker.js 的第一個 import）。遊戲訊息用中文。
globalThis.process ??= {env: {}, argv: []};
process.env ??= {}; process.argv ??= [];
process.env.ASH_LANGUAGE ||= 'zh-TW';
