/** @typedef {function(?, ?)} */
var OnSuccessCallbackType;
/** @typedef {function(!Error, ?)} */
var OnFailCallbackType;

/**
 * An object representing a "promise" for a future value
 *
 * @param {?OnSuccessCallbackType=} onSuccess a function to handle successful
 *     resolution of this promise
 * @param {OnFailCallbackType=} onFail a function to handle failed
 *     resolution of this promise
 * @constructor
 */
function Promise(onSuccess, onFail) {
  this.promise = this
  this._isPromise = true
  this._successFn = onSuccess
  this._failFn = onFail
  this._hasContext = false
  this._nextContext = undefined
  this._currentContext = undefined
}

/**
 * Specify that the current promise should have a specified context
 * @param  {*} context context
 * @private
 */
Promise.prototype._useContext = function (context) {
  this._nextContext = this._currentContext = context
  this._hasContext = true
  return this
}

Promise.prototype.clearContext = function () {
  this._hasContext = false
  this._nextContext = undefined
  return this
}

/**
 * Set the context for all promise handlers to follow
 * @param {*} context An arbitrary context
 */
Promise.prototype.setContext = function (context) {
  this._nextContext = context
  this._hasContext = true
  return this
}

/**
 * Get the context for a promise
 * @return {*} the context set by setContext
 */
Promise.prototype.getContext = function () {
  return this._nextContext
}

/**
 * Resolve this promise with a specified value
 *
 * @param {*} data
 */
Promise.prototype.resolve = function (data) {
  if (this._error || this._hasData) throw new Error("Unable to resolve or reject the same promise twice")

  var i
  if (data && isPromise(data)) {
    this._child = data
    if (this._promises) {
      for (i = 0; i < this._promises.length; i += 1) {
        data._chainPromise(this._promises[i])
      }
      delete this._promises
    }

    if (this._onComplete) {
      for (i = 0; i < this._onComplete.length; i+= 1) {
        data.fin(this._onComplete[i])
      }
      delete this._onComplete
    }
  } else if (data && isPromiseLike(data)) {
    data.then(
      function(data) { this.resolve(data) }.bind(this),
      function(err) { this.reject(err) }.bind(this)
    )
  } else {
    this._hasData = true
    this._data = data

    if (this._onComplete) {
      for (i = 0; i < this._onComplete.length; i++) {
        this._onComplete[i]()
      }
    }

    if (this._promises) {
      for (i = 0; i < this._promises.length; i += 1) {
        this._promises[i]._withInput(data)
      }
      delete this._promises
    }
  }
}

/**
 * Reject this promise with an error
 *
 * @param {!Error} e
 */
Promise.prototype.reject = function (e) {
  if (this._error || this._hasData) throw new Error("Unable to resolve or reject the same promise twice")

  var i
  this._error = e

  if (this._ended) {
    process.nextTick(function onPromiseThrow() {
      throw e
    })
  }

  if (this._onComplete) {
    for (i = 0; i < this._onComplete.length; i++) {
      this._onComplete[i]()
    }
  }

  if (this._promises) {
    for (i = 0; i < this._promises.length; i += 1) {
      this._promises[i]._withError(e)
    }
    delete this._promises
  }
}

/**
 * Provide a callback to be called whenever this promise successfully
 * resolves. Allows for an optional second callback to handle the failure
 * case.
 *
 * @param {?OnSuccessCallbackType} onSuccess
 * @param {OnFailCallbackType=} onFail
 * @return {!Promise} returns a new promise with the output of the onSuccess or
 *     onFail handler
 */
Promise.prototype.then = function (onSuccess, onFail) {
  var promise = new Promise(onSuccess, onFail)
  if (this._nextContext) promise._useContext(this._nextContext)

  if (this._child) this._child._chainPromise(promise)
  else this._chainPromise(promise)

  return promise
}

/**
 * Provide a callback to be called whenever this promise is rejected
 *
 * @param {OnFailCallbackType} onFail
 * @return {!Promise} returns a new promise with the output of the onFail handler
 */
Promise.prototype.fail = function (onFail) {
  return this.then(null, onFail)
}

/**
 * Provide a callback to be called whenever this promise is either resolved
 * or rejected.
 *
 * @param {function()} onComplete
 * @return {!Promise} returns the current promise
 */
Promise.prototype.fin = function (onComplete) {
  if (this._hasData || this._error) {
    onComplete()
    return this
  }

  if (this._child) {
    this._child.fin(onComplete)
  } else {
    if (!this._onComplete) this._onComplete = [onComplete]
    else this._onComplete.push(onComplete)
  }

  return this
}

/**
 * Mark this promise as "ended". If the promise is rejected, this will throw an
 * error in whatever scope it happens to be in
 *
 * @return {!Promise} returns the current promise
 */
Promise.prototype.end = function () {
  if (this._error) {
    throw this._error
  }
  this._ended = true
  return this
}

/**
 * Return a new promise that behaves the same as the current promise except
 * that it will be rejected if the current promise does not get fulfilled
 * after a certain amount of time.
 *
 * @param {number} timeoutMs The timeout threshold in msec
 * @param {string=} timeoutMsg error message
 * @returns a new promise with timeout
 */
 Promise.prototype.timeout = function (timeoutMs, timeoutMsg) {
  var deferred = new Promise()
  var isTimeout = false

  var timeout = setTimeout(function() {
    deferred.reject(new Error(timeoutMsg || 'Promise timeout after ' + timeoutMs + ' ms.'))
    isTimeout = true
  }, timeoutMs)

  this.then(function (data) {
    if (!isTimeout) {
      clearTimeout(timeout)
      deferred.resolve(data)
    }
  },
  function (err) {
    if (!isTimeout) {
      clearTimeout(timeout)
      deferred.reject(err)
    }
  })

  return deferred.promise
}

/**
 * Attempt to resolve this promise with the specified input
 *
 * @param {*} data the input
 */
Promise.prototype._withInput = function (data) {
  if (this._successFn) {
    try {
      this.resolve(this._successFn(data, this._currentContext))
    } catch (e) {
      this.reject(e)
    }
  } else this.resolve(data)

  // context is no longer needed
  delete this._currentContext
}

/**
 * Attempt to reject this promise with the specified error
 *
 * @param {!Error} e
 * @private
 */
Promise.prototype._withError = function (e) {
  if (this._failFn) {
    try {
      this.resolve(this._failFn(e, this._currentContext))
    } catch (thrown) {
      this.reject(thrown)
    }
  } else this.reject(e)

  // context is no longer needed
  delete this._currentContext
}

/**
 * Chain a promise to the current promise
 *
 * @param {!Promise} promise the promise to chain
 * @private
 */
Promise.prototype._chainPromise = function (promise) {
  var i
  if (this._hasContext) promise._useContext(this._nextContext)

  if (this._child) {
    this._child._chainPromise(promise)
  } else if (this._hasData) {
    promise._withInput(this._data)
  } else if (this._error) {
    promise._withError(this._error)
  } else if (!this._promises) {
    this._promises = [promise]
  } else {
    this._promises.push(promise)
  }
}

/**
 * Utility function used for creating a node-style resolver
 * for deferreds
 *
 * @param {!Promise} deferred a promise that looks like a deferred
 * @param {Error=} err an optional error
 * @param {*=} data optional data
 */
function resolver(deferred, err, data) {
  if (err) deferred.reject(err)
  else deferred.resolve(data)
}

/**
 * Creates a node-style resolver for a deferred by wrapping
 * resolver()
 *
 * @return {function(?Error, *)} node-style callback
 */
Promise.prototype.makeNodeResolver = function () {
  return resolver.bind(null, this)
}

/**
 * Return true iff the given object is a promise of this library.
 *
 * Because kew's API is slightly different than other promise libraries,
 * it's important that we have a test for its promise type. If you want
 * to test for a more general A+ promise, you should do a cap test for
 * the features you want.
 *
 * @param {*} obj The object to test
 * @return {boolean} Whether the object is a promise
 */
function isPromise(obj) {
  return !!obj._isPromise
}

/**
 * Return true iff the given object is a promise-like object, e.g. appears to
 * implement Promises/A+ specification
 *
 * @param {*} obj The object to test
 * @return {boolean} Whether the object is a promise-like object
 */
function isPromiseLike(obj) {
  return typeof obj === 'object' && typeof obj.then === 'function'
}

/**
 * Static function which creates and resolves a promise immediately
 *
 * @param {*} data data to resolve the promise with
 * @return {!Promise}
 */
function resolve(data) {
  var promise = new Promise()
  promise.resolve(data)
  return promise
}

/**
 * Static function which creates and rejects a promise immediately
 *
 * @param {!Error} e error to reject the promise with
 * @return {!Promise}
 */
function reject(e) {
  var promise = new Promise()
  promise.reject(e)
  return promise
}

/**
 * Replace an element in an array with a new value. Used by .all() to
 * call from .then()
 *
 * @param {!Array} arr
 * @param {number} idx
 * @param {*} val
 * @return {*} the val that's being injected into the array
 */
function replaceEl(arr, idx, val) {
  arr[idx] = val
  return val
}

/**
 * Replace an element in an array as it is resolved with its value.
 * Used by .allSettled().
 *
 * @param {!Array} arr
 * @param {number} idx
 * @param {*} value The value from a resolved promise.
 * @return {*} the data that's being passed in
 */
function replaceElFulfilled(arr, idx, value) {
  arr[idx] = {
    state: 'fulfilled',
    value: value
  }
  return value
}

/**
 * Replace an element in an array as it is rejected with the reason.
 * Used by .allSettled().
 *
 * @param {!Array} arr
 * @param {number} idx
 * @param {*} reason The reason why the original promise is rejected
 * @return {*} the data that's being passed in
 */
function replaceElRejected(arr, idx, reason) {
  arr[idx] = {
    state: 'rejected',
    reason: reason
  }
  return reason
}

/**
 * Takes in an array of promises or literals and returns a promise which returns
 * an array of values when all have resolved. If any fail, the promise fails.
 *
 * @param {!Array.<!Promise>} promises
 * @return {!Promise}
 */
function all(promises) {
  if (arguments.length != 1 || !Array.isArray(promises)) {
    promises = Array.prototype.slice.call(arguments, 0)
  }
  if (!promises.length) return resolve([])

  var outputs = []
  var finished = false
  var promise = new Promise()
  var counter = promises.length

  for (var i = 0; i < promises.length; i += 1) {
    if (!promises[i] || !isPromiseLike(promises[i])) {
      outputs[i] = promises[i]
      counter -= 1
    } else {
      promises[i].then(replaceEl.bind(null, outputs, i))
      .then(function decrementAllCounter() {
        counter--
        if (!finished && counter === 0) {
          finished = true
          promise.resolve(outputs)
        }
      }, function onAllError(e) {
        if (!finished) {
          finished = true
          promise.reject(e)
        }
      })
    }
  }

  if (counter === 0 && !finished) {
    finished = true
    promise.resolve(outputs)
  }

  return promise
}

/**
 * Takes in an array of promises or literals and returns a promise which returns
 * an array of values when all have resolved or rejected.
 *
 * @param {!Array.<!Promise>} promises
 * @return {!Array.<Object>} The state of the promises. If a promise is resolved,
 *     its corresponding state object is {state: 'fulfilled', value: Object};
 *     whereas if a promise is rejected, its corresponding state object is
 *     {state: 'rejected', reason: Object}
 */
function allSettled(promises) {
  if (!Array.isArray(promises)) {
    throw Error('The input to "allSettled()" should be an array of Promise')
  }
  if (!promises.length) return resolve([])

  var outputs = []
  var promise = new Promise()
  var counter = promises.length

  for (var i = 0; i < promises.length; i += 1) {
    if (!promises[i] || !isPromiseLike(promises[i])) {
      replaceElFulfilled(outputs, i, promises[i])
      if ((--counter) === 0) promise.resolve(outputs)
    } else {
      promises[i]
        .then(replaceElFulfilled.bind(null, outputs, i), replaceElRejected.bind(null, outputs, i))
        .then(function () {
          if ((--counter) === 0) promise.resolve(outputs)
        })
    }
  }

  return promise
}

/**
 * Create a new Promise which looks like a deferred
 *
 * @return {!Promise}
 */
function defer() {
  return new Promise()
}

/**
 * Return a promise which will wait a specified number of ms to resolve
 *
 * @param {number} delayMs
 * @param {*} returnVal
 * @return {!Promise} returns returnVal
 */
function delay(delayMs, returnVal) {
  var defer = new Promise()
  setTimeout(function onDelay() {
    defer.resolve(returnVal)
  }, delayMs)
  return defer
}

/**
 * Return a promise which will evaluate the function fn in a future turn with
 * the provided args
 *
 * @param {function(...)} fn
 * @param {...} var_args a variable number of arguments
 * @return {!Promise}
 */
function fcall(fn, var_args) {
  var rootArgs = Array.prototype.slice.call(arguments, 1)
  var defer = new Promise()
  process.nextTick(function onNextTick() {
    defer.resolve(fn.apply(undefined, rootArgs))
  })
  return defer
}


/**
 * Returns a promise that will be invoked with the result of a node style
 * callback. All args to fn should be given except for the final callback arg
 *
 * @param {function(...)} fn
 * @param {...} var_args a variable number of arguments
 * @return {!Promise}
 */
function nfcall(fn, var_args) {
  // Insert an undefined argument for scope and let bindPromise() do the work.
  var args = Array.prototype.slice.call(arguments, 0)
  args.splice(1, 0, undefined)
  return bindPromise.apply(undefined, args)()
}


/**
 * Binds a function to a scope with an optional number of curried arguments. Attaches
 * a node style callback as the last argument and returns a promise
 *
 * @param {function(...)} fn
 * @param {Object} scope
 * @param {...} var_args a variable number of arguments
 * @return {function(...)}: !Promise}
 */
function bindPromise(fn, scope, var_args) {
  var rootArgs = Array.prototype.slice.call(arguments, 2)
  return function onBoundPromise(var_args) {
    var defer = new Promise()
    fn.apply(scope, rootArgs.concat(Array.prototype.slice.call(arguments, 0), defer.makeNodeResolver()))
    return defer
  }
}

module.exports = {
    all: all
  , bindPromise: bindPromise
  , defer: defer
  , delay: delay
  , fcall: fcall
  , isPromise: isPromise
  , isPromiseLike: isPromiseLike
  , nfcall: nfcall
  , resolve: resolve
  , reject: reject
  , allSettled: allSettled
}
