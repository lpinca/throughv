'use strict'

var Duplex = require('readable-stream/duplex')
var inherits = require('inherits')
var parallel = require('fastparallel')()

function BulkTransformState (stream) {
  this.afterTransform = function (er, data) {
    return afterTransform(stream, er, data)
  }

  this.needTransform = false
  this.transforming = false
  this.entries = []
  this.entriescb = null
}

function afterTransform (stream, er, data) {
  var ts = stream._transformState
  ts.transforming = false

  var cb = ts.entriescb

  if (!cb) {
    return stream.emit('error', new Error('no entries in BulkTransform class'))
  }

  ts.entries = null
  ts.entriescb = null

  for (var i = 0, l = data.length; i < l; i++) {
    if (data[i] !== null && data[i] !== undefined) {
      stream.push(data[i])
    }
  }

  if (cb) {
    cb(er)
  }

  var rs = stream._readableState
  rs.reading = false
  if (rs.needReadable || rs.length < rs.highWaterMark) {
    stream._read(rs.highWaterMark)
  }
}

function BulkTransform (options, transform) {
  if (!(this instanceof BulkTransform)) {
    if (typeof options === 'function') {
      transform = options
      options = {}
    }
    if (transform) {
      options.transform = transform
    }
    return new BulkTransform(options)
  }

  Duplex.call(this, options)

  this._transformState = new BulkTransformState(this)

  var stream = this

  // start out asking for a readable event once data is transformed.
  this._readableState.needReadable = true

  // we have implemented the _read method, and done the other things
  // that Readable wants before the first _read call, so unset the
  // sync guard flag.
  this._readableState.sync = false

  if (options) {
    if (typeof options.transform === 'function') {
      this._transform = options.transform
    }

    if (typeof options.flush === 'function') {
      this._flush = options.flush
    }
  }

  this.once('prefinish', function () {
    if (typeof this._flush === 'function') {
      this._flush(function (er) {
        done(stream, er)
      })
    } else {
      done(stream)
    }
  })
}

inherits(BulkTransform, Duplex)

BulkTransform.prototype._transform = function (chunk, encoding, cb) {
  throw new Error('not implemented')
}

BulkTransform.prototype._writev = function (chunks, cb) {
  var ts = this._transformState
  ts.entriescb = cb
  ts.entries = chunks
  if (!ts.transforming) {
    var rs = this._readableState
    if (ts.needTransform ||
        rs.needReadable ||
        rs.length < rs.highWaterMark) {
      this._read(rs.highWaterMark)
    }
  }
}

BulkTransform.prototype._write = function (chunk, encoding, cb) {
  this._writev([{
    chunk: chunk,
    encoding: encoding,
    callback: noop
  }], cb)
}

function noop () {}

// Doesn't matter what the args are here.
// _transform does all the work.
// That we got here means that the readable side wants more data.
BulkTransform.prototype._read = function (n) {
  var ts = this._transformState

  if (ts.entries !== null && ts.entriescb && !ts.transforming) {
    ts.transforming = true
    parallel(this, process, ts.entries, ts.afterTransform)
  } else {
    // mark that we need a transform, so that any data that comes in
    // will get processed, now that we've asked for it.
    ts.needTransform = true
  }
}

function process (entry, cb) {
  this._transform(entry.chunk, entry.encoding, cb)
}

function done (stream, er) {
  if (er) {
    return stream.emit('error', er)
  }

  // if there's nothing in the write buffer, then that means
  // that nothing more will ever be provided
  var ws = stream._writableState
  var ts = stream._transformState

  if (ws.length) {
    throw new Error('calling transform done when ws.length != 0')
  }

  if (ts.transforming) {
    throw new Error('calling transform done when still transforming')
  }

  return stream.push(null)
}

BulkTransform.obj = function (opts, transform) {
  if (typeof opts === 'function') {
    transform = opts
    opts = {}
  }

  opts.objectMode = true
  opts.transform = transform

  return new BulkTransform(opts)
}

module.exports = BulkTransform
