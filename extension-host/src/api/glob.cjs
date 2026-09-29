"use strict";

/**
 * Minimal glob → RegExp for `findFiles`, `createFileSystemWatcher` and
 * document selectors: `**`, `*`, `?`, `{a,b}` and `[...]`, matched against
 * forward-slash paths.
 */
function globToRegExp(glob) {
  let source = "";
  let inGroup = false;
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    switch (ch) {
      case "*":
        if (glob[i + 1] === "*") {
          // `**/` matches zero or more directories.
          if (glob[i + 2] === "/") {
            source += "(?:.*/)?";
            i += 2;
          } else {
            source += ".*";
            i++;
          }
        } else {
          source += "[^/]*";
        }
        break;
      case "?":
        source += "[^/]";
        break;
      case "{":
        inGroup = true;
        source += "(?:";
        break;
      case "}":
        if (inGroup) {
          inGroup = false;
          source += ")";
        } else {
          source += "\\}";
        }
        break;
      case ",":
        source += inGroup ? "|" : ",";
        break;
      case "[": {
        const close = glob.indexOf("]", i + 1);
        if (close === -1) {
          source += "\\[";
        } else {
          source += `[${glob
            .slice(i + 1, close)
            .replace(/^!/, "^")
            .replace(/\\/g, "\\\\")}]`;
          i = close;
        }
        break;
      }
      default:
        source += ch.replace(/[.+^$()|\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

function toPosix(p) {
  return p.replace(/\\/g, "/");
}

module.exports = { globToRegExp, toPosix };
