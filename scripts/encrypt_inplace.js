"use strict";

const { log, route } = hexo;
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function arrayBufferToHex(arrayBuffer) {
  if (typeof arrayBuffer !== "object" || arrayBuffer === null || typeof arrayBuffer.byteLength !== "number") {
    throw new TypeError("Expected input to be an ArrayBuffer");
  }

  let view = new Uint8Array(arrayBuffer);
  let result = "";
  let value;

  for (let i = 0; i < view.length; i++) {
    value = view[i].toString(16);
    result += value.length === 1 ? "0" + value : value;
  }

  return result;
}

hexo.extend.generator.register("custom-encrypt", () => [
  {
    data: () => fs.createReadStream(path.resolve(__dirname, "../source/js/__hash_decrypt.js")),
    path: "/js/__hash_decrypt.js",
  },
]);

hexo.extend.filter.register(
  "after_post_render",
  (data) => {
    if (data.encrypt) {
      const processLinks = (content) => {
        // plugins/filter/after_render/external_link.js
        const util = require("hexo-util");
        const rATag = /<a(?:\s+?|\s+?[^<>]+?\s+?)href=["']((?:https?:|\/\/)[^<>"']+)["'][^<>]*>/gi;
        const rTargetAttr = /target=/i;
        const rRelAttr = /rel=/i;
        const rRelStrAttr = /rel=["']([^<>"']*)["']/i;
        const { external_link, url } = hexo.config;
        if (!external_link.enable || external_link.field !== "site") {
          return content;
        }
        return content.replace(rATag, (str, href) => {
          if (!(0, util.isExternalLink)(href, url, external_link.exclude) || rTargetAttr.test(str)) {
            return str;
          }
          if (rRelAttr.test(str)) {
            str = str.replace(rRelStrAttr, (relStr, rel) => {
              return rel.includes("noopenner") ? relStr : `rel="${rel} noopener"`;
            });
            return str.replace("href=", 'target="_blank" href=');
          }
          return str.replace("href=", 'target="_blank" rel="noopener" href=');
        });
      };
      data.content = processLinks(data.content);
      const password = data.encrypt_pwd || "show";
      log.debug("encrypt article >> ", data.title);
      const key = crypto.pbkdf2Sync(password, "ksalt", 1024, 32, "sha256");
      const iv = crypto.pbkdf2Sync(password, "ivsalt", 512, 12, "sha256");
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      log.debug("key=", arrayBufferToHex(key));
      log.debug("iv=", arrayBufferToHex(iv));
      // cipher.setAutoPadding(true); // GCM mode does not use padding
      let encrypted = cipher.update(data.content, "utf8", "hex");
      encrypted += cipher.final("hex");
      encrypted += arrayBufferToHex(cipher.getAuthTag());
      data.content = `<div id="encrypted-content">${encrypted}</div>`;
      data.content += `<script data-pjax src="${hexo.config.root}js/__hash_decrypt.js"></script>`;
    }
    return data;
  },
  10
);
