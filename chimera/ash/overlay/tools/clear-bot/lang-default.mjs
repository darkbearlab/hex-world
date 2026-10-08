// The clear bot plays in English unless ASH_LANGUAGE says otherwise (user, 2026-10-01: videos and bot runs are made in
// English first, for itch.io; other languages come later). Imported first by every entry point, before any game
// module reads the language (src/i18n.js picks it once, when it loads).
if(!process.env.ASH_LANGUAGE)process.env.ASH_LANGUAGE='en';
