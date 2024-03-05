"use strict";

const { log, route } = hexo;
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function arrayBufferToHex(arrayBuffer) {
  if (
    typeof arrayBuffer !== "object" ||
    arrayBuffer === null ||
    typeof arrayBuffer.byteLength !== "number"
  ) {
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
    data: () =>
      fs.createReadStream(
        path.resolve(__dirname, "../source/js/__hash_decrypt.js")
      ),
    path: "/js/__hash_decrypt.js",
  },
]);

hexo.extend.filter.register(
  "after_post_render",
  (data) => {
    if (data.encrypt) {
      const password = data.encrypt_pwd || "show";
      log.debug("encrypt article >> ", data.title);
      const key = crypto.pbkdf2Sync(password, "ksalt", 1024, 32, "sha256");
      const iv = crypto.pbkdf2Sync(password, "ivsalt", 512, 12, "sha256");
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      log.debug("key=", arrayBufferToHex(key));
      log.debug("iv=", arrayBufferToHex(iv));
      // cipher.setAutoPadding(true);
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
