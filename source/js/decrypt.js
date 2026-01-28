'use strict';
(() => {
  // Normalize URL so relative asset URLs resolve correctly.
  // Some static servers redirect `/dir/index.html` -> `/dir` (no trailing slash),
  // and browsers then treat `/dir` as a file, making `full.ogg` resolve to `/<asset>`.
  // We rewrite it to `/dir/` (or strip `/index.html`) without reloading.
  (() => {
    try {
      const url = new URL(window.location.href);
      let pathname = url.pathname;

      if (pathname.endsWith('/index.html')) {
        pathname = pathname.slice(0, -'index.html'.length);
      }

      const parts = pathname.split('/').filter(Boolean);
      const last = parts.length ? parts[parts.length - 1] : '';
      const looksLikeFile = last.includes('.');

      if (!pathname.endsWith('/') && !looksLikeFile) {
        pathname += '/';
      }

      if (pathname !== url.pathname) {
        window.history.replaceState(null, '', pathname + url.search + url.hash);
      }
    } catch (_) {
      /* ignore */
    }
  })();

  const crypto = window.crypto || window.msCrypto;

  const encoder = new TextEncoder();

  const keySalt = encoder.encode('ksalt');
  const ivSalt = encoder.encode('ivsalt');

  const encryptedElement = document.getElementById('encrypted-content');
  if (!encryptedElement) {
    return;
  }
  const encryptedContent = encryptedElement.innerText;

  function hexToArray(s) {
    return new Uint8Array(
      s.match(/[\da-f]{2}/gi).map((h) => {
        return parseInt(h, 16);
      })
    );
  }

  function getKeyMaterial(password) {
    return crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      {
        name: 'PBKDF2',
      },
      false,
      ['deriveKey', 'deriveBits']
    );
  }

  function getKey(keyMaterial) {
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: keySalt.buffer,
        iterations: 1024,
      },
      keyMaterial,
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['decrypt']
    );
  }

  function getIv(keyMaterial) {
    return crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: ivSalt.buffer,
        iterations: 512,
      },
      keyMaterial,
      12 * 8
    );
  }

  function decrypt() {
    const password = window.location.hash.slice(1);
    let contentArray = hexToArray(encryptedContent);

    const doDecrypt = async () => {
      const keyMaterial = await getKeyMaterial(password);
      const key = await getKey(keyMaterial);
      const iv = await getIv(keyMaterial);

      // console.log('key=', arrayBufferToHex(await crypto.subtle.exportKey('raw', key)));
      // console.log('iv=', arrayBufferToHex(iv));

      const result = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv,
        },
        key,
        contentArray
      );

      return result;
    };

    doDecrypt()
      .then((result) => {
        const content = new TextDecoder().decode(result);
        encryptedElement.parentElement.innerHTML = content;
        // if successfully decrypted, emit a 'DecrptEnded' event
        document.dispatchEvent(new Event('DecryptEnded', { cancelable: false, bubbles: false }));
      })
      .catch((e) => {
        /* suppress */
        // console.log(e.name);
      });
  }
  window.onhashchange = decrypt;
  decrypt();
})();