onmessage = e => {
  const blob = e.data
  loadAPNGForWorker(blob).then(apngBlob => {
    postMessage(apngBlob)
    close()
  })
}

function loadAPNG(blob) {
  return new APNG().load(blob).then(([frames, iterations]) => {
    const framePromises = frames.map(frame => {
      return new Promise(async (resolve, reject) => {
        const reader = new FileReader()

        reader.onload = () => {
          const image = new Image()

          image.onload = () => {
            resolve(image)
          }
          image.onerror = error => {
            reject(error)
          }
          image.crossOrigin = 'anonymous'
          image.src = reader.result
        }
        reader.onerror = () => {
          reject(reader.error)
        }
        reader.readAsDataURL(frame.blob)
      })
    })
    return Promise.all(framePromises).then(images => {
      const delays = frames.map(frame => frame.delay * 1000)
      return { images, delays }
    })
  })
}

function loadAPNGForWorker(blob) {
  return new APNG().load(blob).then(([frames, iterations]) => {
    const delays = frames.map(frame => frame.delay * 1000)
    return { frames, delays }
  })
}

function playAPNG(apng, canvas, x, y, w, h, reversed, onFinish, onTick) {
  let a = apng
  if (reversed) {
    a = {
      images: apng.images.slice().reverse(),
      delays: apng.delays.slice().reverse(),
    }
  }
  const ctx = canvas.getContext('2d')
  a.images.forEach((image, index) => {
    setTimeout(
      () => {
        if (!ctx.canvas) return
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(image, x, y, w, h)
        if (onTick) onTick(index)
        if (onFinish && index == a.images.length - 1) onFinish()
      },
      a.delays.slice(0, index).reduce((acc, val) => acc + val, 0)
    )
  })
}

class APNG {
  constructor() {
    this.PNG_SIGNATURE_BYTES = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ])
    this.crc32Table = new Uint32Array(256)

    for (let i = 0; i < 256; i++) {
      let c = i

      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      }

      this.crc32Table[i] = c
    }
  }

  get signature() {
    return this.PNG_SIGNATURE_BYTES
  }

  load(blob) {
    return new Promise(async (resolve1, reject1) => {
      const self = this
      const bytes = new Uint8Array(blob.buffer)

      if (this.signature.every((element, index) => element === bytes[index])) {
        let isAnimatable = false

        this.parseChunks(bytes, type => {
          if (type === 'acTL') {
            isAnimatable = true

            return false
          }

          return true
        })

        if (isAnimatable) {
          const preDataParts = []
          const postDataParts = []
          let headerDataBytes = null
          let frame = null
          const animation = { frames: [] }
          const frames = []

          this.parseChunks(bytes, (type, bytes, offset, length) => {
            switch (type) {
              case 'IHDR':
                headerDataBytes = bytes.subarray(
                  offset + 8,
                  offset + 8 + length
                )
                animation.width = self.readDWord(bytes, offset + 8)
                animation.height = self.readDWord(bytes, offset + 12)

                break

              case 'acTL':
                animation.iterations = self.readDWord(bytes, offset + 8 + 4)

                break

              case 'fcTL':
                if (frame) {
                  animation.frames.push(frame)
                }

                frame = {}
                frame.width = self.readDWord(bytes, offset + 8 + 4)
                frame.height = self.readDWord(bytes, offset + 8 + 8)
                frame.left = self.readDWord(bytes, offset + 8 + 12)
                frame.top = self.readDWord(bytes, offset + 8 + 16)

                const delayN = self.readWord(bytes, offset + 8 + 20)
                let delayD = self.readWord(bytes, offset + 8 + 22)

                if (delayD === 0) {
                  delayD = 100
                }

                frame.delay = delayN / delayD

                if (frame.delay <= 0.01) {
                  frame.delay = 0.1
                }

                animation.playTime += frame.delay
                frame.disposeOp = bytes[offset + 8 + 24]
                frame.blendOp = bytes[offset + 8 + 25]
                frame.dataParts = []

                break

              case 'fdAT':
                if (frame) {
                  frame.dataParts.push(
                    bytes.subarray(offset + 8 + 4, offset + 8 + length)
                  )
                }

                break

              case 'IDAT':
                if (frame) {
                  frame.dataParts.push(
                    bytes.subarray(offset + 8, offset + 8 + length)
                  )
                }

                break

              case 'IEND':
                postDataParts.push(self.subBuffer(bytes, offset, 12 + length))

                break

              default:
                preDataParts.push(self.subBuffer(bytes, offset, 12 + length))
            }
          })

          if (frame !== null) {
            animation.frames.push(frame)
          }

          if (animation.frames.length > 0) {
            const preBlob = new Blob(preDataParts)
            const postBlob = new Blob(postDataParts)
            for (const frame of animation.frames) {
              const chunks = []

              chunks.push(this.signature)
              headerDataBytes.set(this.buildDWordArray(frame.width), 0)
              headerDataBytes.set(this.buildDWordArray(frame.height), 4)
              chunks.push(this.buildChunkBytes('IHDR', headerDataBytes))
              chunks.push(preBlob)

              for (let j = 0; j < frame.dataParts.length; j++) {
                chunks.push(this.buildChunkBytes('IDAT', frame.dataParts[j]))
              }

              chunks.push(postBlob)

              frames.push({
                delay: frame.delay,
                blob: await new Promise(async (resolve2, reject2) => {
                  resolve2(new Blob(chunks, { type: 'image/png' }))
                }),
              })
            }

            resolve1([frames, animation.iterations])

            return
          }
        }
      }

      resolve1(null)
    })
  }

  parseChunks(bytes, callback) {
    let offset = 8
    let type
    let done

    do {
      const length = this.readDWord(bytes, offset)

      type = this.readString(bytes, offset + 4, 4)
      done = callback(type, bytes, offset, length)
      offset += 12 + length
    } while (done !== false && type != 'IEND' && offset < bytes.length)
  }

  readDWord(bytes, offset) {
    let x = 0

    x += (bytes[0 + offset] << 24) >>> 0

    for (let i = 1; i < 4; i++) {
      x += bytes[i + offset] << ((3 - i) * 8)
    }

    return x
  }

  readWord(bytes, offset) {
    let x = 0

    for (let i = 0; i < 2; i++) {
      x += bytes[i + offset] << ((1 - i) * 8)
    }

    return x
  }

  subBuffer(bytes, start, length) {
    const a = new Uint8Array(length)

    a.set(bytes.subarray(start, start + length))

    return a
  }

  readString(bytes, offset, length) {
    const chars = Array.prototype.slice.call(
      bytes.subarray(offset, offset + length)
    )

    return String.fromCharCode.apply(String, chars)
  }

  buildDWordArray(x) {
    return [(x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff]
  }

  buildStringArray(x) {
    const buffer = []

    for (let i = 0; i < x.length; i++) {
      buffer.push(x.charCodeAt(i))
    }

    return buffer
  }

  buildChunkBytes(type, dataBytes) {
    const crcLen = type.length + dataBytes.length
    const bytes = new Uint8Array(new ArrayBuffer(crcLen + 8))

    bytes.set(this.buildDWordArray(dataBytes.length), 0)
    bytes.set(this.buildStringArray(type), 4)
    bytes.set(dataBytes, 8)

    const crc = this.crc32(bytes, 4, crcLen)

    bytes.set(this.buildDWordArray(crc), crcLen + 4)

    return bytes
  }

  crc32(bytes, start, length) {
    start = start || 0
    length = length || bytes.length - start

    let crc = -1

    for (let i = start, l = start + length; i < l; i++) {
      crc = (crc >>> 8) ^ this.crc32Table[(crc ^ bytes[i]) & 0xff]
    }

    return crc ^ -1
  }
}
