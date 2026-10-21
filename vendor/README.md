# HEIC decoder

heic-to-1.5.2.js is the unmodified IIFE build from the npm package
heic-to@1.5.2, by Hopper Gee. It bundles libheif 1.22.2 and libde265
1.0.16. It is loaded as a separate script only when native HEIC decoding
fails, and performs decoding in a local Web Worker.

- Package: https://registry.npmjs.org/heic-to/-/heic-to-1.5.2.tgz
- Package SHA-512: 8Fns+lZHAWmz5U5IUxDeXKwIf3foBoKNPLxxFY4B0MkLjNuomEIHCoDbDE+x/llFK3NCEO1cu4+n3iUKY+Svmw==
- Wrapper and build source: https://github.com/hoppergee/heic-to/tree/v1.5.2
- Decoder source: https://github.com/strukturag/libheif/tree/v1.22.2
- HEVC source: https://github.com/strukturag/libde265/tree/v1.0.16
- Build instructions: https://github.com/hoppergee/heic-to/blob/v1.5.2/README.md

The wrapper is LGPL-3.0-or-later; see heic-to-LICENSE.txt.
The bundled decoders' original notices and license terms are reproduced in
libheif-COPYING.txt and libde265-COPYING.txt; GPL-3.0.txt contains the
referenced GNU GPL terms. The browser build remains a separately replaceable,
unmodified library, with its corresponding sources linked above.

Photo contents are never sent to these sources or to a conversion service.
The decoder script is served by this app and cached for offline use.
