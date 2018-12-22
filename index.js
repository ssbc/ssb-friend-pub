var pull = require('pull-stream')
var sort = require('ssb-sort')

exports.name = 'friendPub'
exports.version = require('./package.json').version
exports.manifest = {
  pubs: 'sync',
  pubChanges: 'async',
  changeHops: 'sync'
}

exports.init = function (sbot, config) {
  sbot.emit('log:info', ['SBOT', 'friend pubs init'])

  if (!sbot.friends || !sbot.friends.hopStream) {
    sbot.emit('log:error', ['SBOT', 'missing sbot.friends.hopStream'])
    return
  }

  var runtimeFriendHops = null
  // pull-abortable doesn't work with live streams
  var aborted = []

  var cbs = []
  var dists = {}

  function gotHops(data) {
    let friendHops = runtimeFriendHops != null ? runtimeFriendHops : (config.friendPub && config.friendPub.hops || 1)
    let wasChange = false
    for (let k in data) {
      if (data[k] <= friendHops && (dists[k] > friendHops || dists[k] === undefined))
        wasChange = true
      else if (data[k] > friendHops && dists[k] <= friendHops)
        wasChange = true

      dists[k] = data[k]
    }

    if (wasChange) {
      if (aborted.length > 0) aborted[aborted.length-1] = true
      aborted.push(false)
      calculatePubsWithinFriendHops(aborted.length - 1)
    }
  }
  
  pull(
    sbot.friends.hopStream({live: false, old: true}),
    pull.drain(gotHops, function (err) {
      if (err) return console.trace(err)
      while (cbs.length) cbs.shift()()
      cbs = null
    })
  )

  pull(
    sbot.friends.hopStream({live: true, old: false}),
    pull.drain(gotHops)
  )

  function onReady(fn) {
    if (cbs) cbs.push(fn)
    else fn()
  }

  var pubs = {}
  var pubsChangeCb = null
  
  function calculatePubsWithinFriendHops(abortIndex) {
    pubs = {}
    if (pubsChangeCb) pubsChangeCb(pubs)

    pull(
      sbot.messagesByType({ live: true, type: 'pub-owner-announce' }),
      pull.filter(msg => !msg.sync),
      pull.drain(announceMsg => {
        if (aborted[abortIndex]) return false
        onReady(() => {
          let friendHops = runtimeFriendHops != null ? runtimeFriendHops : (config.friendPub && config.friendPub.hops || 1)
          let hops = dists[announceMsg.value.author]
          if (hops <= friendHops) {
            function handleUpdate(msg)
            {
              if (aborted[abortIndex]) return false
              if (msg.sync) return

              let type = msg.value.content.type

              if (type == "pub-owner-confirm" && msg.value.author == announceMsg.value.content.id)
                pubs[announceMsg.value.content.id] = msg.value.content
              else if (type == "pub-owner-retract" && msg.value.author == announceMsg.value.author)
                delete pubs[announceMsg.value.content.id]
              else if (type == "pub-owner-reject" && msg.value.author == announceMsg.value.content.id)
                delete pubs[announceMsg.value.content.id]

              if (pubsChangeCb) pubsChangeCb(pubs)
            }

            pull(
              sbot.backlinks.read({
                query: [ {$filter: { dest: announceMsg.key }} ],
                index: 'DTA', // use asserted timestamps
                live: false,
                old: true
              }),
              pull.collect((err, msgs) => {
                if (msgs) {
                  let sorted = sort(msgs)
                  sorted.forEach(handleUpdate)
                }
              })
            )

            pull(
              sbot.backlinks.read({
                query: [ {$filter: { dest: announceMsg.key }} ],
                index: 'DTA', // use asserted timestamps
                live: true,
                old: false
              }),
              pull.drain(handleUpdate)
            )
          }
        })
      })
    )
  }

  return {
    pubs: function() { return pubs },
    pubChanges: function(cb) {
      pubsChangeCb = cb
      cb(pubs)
    },
    changeHops: function(newHops) {
      runtimeFriendHops = newHops

      if (aborted.length > 0) aborted[aborted.length-1] = true
      aborted.push(false)
      calculatePubsWithinFriendHops(aborted.length - 1)
    }
  }
}
