const BLOCKED_WORDS = [
  "fuck","shit","bitch","ass","damn","dick","cock","pussy","bastard",
  "slut","whore","cunt","fag","retard","nigger","nigga","stfu","gtfo",
  "lmfao","wtf","asshole","jackass","dumbass","bullshit","motherfucker",
  "piss","crap","douche","twat","wanker","bollocks","arsehole","arse",
  "nazi","rape","porn","sex","penis","vagina","boob","tits","dildo",
];

const pattern = new RegExp(
  "\\b(" + BLOCKED_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b",
  "i",
);

export function containsProfanity(text) {
  return pattern.test(text);
}

export function sanitizeBio(text) {
  return text.replace(pattern, (match) => "*".repeat(match.length));
}
