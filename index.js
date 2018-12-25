const pull = require('pull-stream')
const sort = require('ssb-sort')
const ref = require('ssb-ref')

exports.name = 'friendPub'
exports.version = require('./package.json').version
exports.manifest = {
  pubs: 'sync',
  pubChanges: 'async',
  changeHops: 'sync'
}

exports.init = function (sbot, config) {
  sbot.emit('log:info', ['SBOT', 'ssb-friend-pub init'])

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
    if (pubsChangeCb) pubsChangeCb(Object.values(pubs))

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

              let type = msg.value.content.type

              if (type == "pub-owner-confirm" && msg.value.author == announceMsg.value.content.pub) {
                pubs[announceMsg.value.content.id] = {
                  announcement: msg.value.content.announcement,
                  address: msg.value.content.address,
                  owner: announceMsg.value.author,
                  id: msg.value.author
                }
              }
              else if (type == "pub-owner-retract" && msg.value.author == announceMsg.value.author)
                delete pubs[announceMsg.value.content.id]
              else if (type == "pub-owner-reject" && msg.value.author == announceMsg.value.content.pub)
                delete pubs[announceMsg.value.content.id]

              if (pubsChangeCb) pubsChangeCb(Object.values(pubs))
            }

            pull(
              sbot.backlinks.read({
                query: [ {$filter: { dest: announceMsg.key }} ],
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
                live: true,
                old: false
              }),
              pull.filter(msg => !msg.sync),
              pull.drain(handleUpdate)
            )
          }
        })
      })
    )
  }

  var existingPubs = []

  pubsChangeCb = function (newPubs) {
    if (!sbot.gossip) return // tests

    console.log("[ssb-friend-pub] pub list: ", newPubs)

    // FIXME: do a diff set instead

    existingPubs.forEach(function(pub) {
      if (ref.isAddress(pub.address))
        sbot.gossip.remove(ref.parseAddress(pub.address)) // make sure we have key
    })

    existingPubs = newPubs.slice()

    function fixAddressAndGossipAdd(address, pub)
    {
      if (address.indexOf('~') != -1)
        pub.address = address
      else
        pub.address = ref.toMultiServerAddress(ref.parseAddress(address))
      sbot.gossip.add(pub.address, 'friends')
    }

    existingPubs.forEach(function(pub) {
      if (sbot.deviceAddress) {
        sbot.deviceAddress.getAddress(pub.id, (err, deviceAddress) => {
          if (deviceAddress)
            fixAddressAndGossipAdd(deviceAddress.address, pub)
          else if (ref.isAddress(pub.address)) {
            fixAddressAndGossipAdd(pub.address, pub)
          }
        })
      }
      else {
        if (ref.isAddress(pub.address)) {
          fixAddressAndGossipAdd(pub.address, pub)
        }
      }
    })
  }

  return {
    pubs: function() { return Object.values(pubs) },
    pubChanges: function(cb) { // FIXME: this overwrites internal
      pubsChangeCb = cb
    },
    changeHops: function(newHops) {
      runtimeFriendHops = newHops

      if (aborted.length > 0) aborted[aborted.length-1] = true
      aborted.push(false)
      calculatePubsWithinFriendHops(aborted.length - 1)
    }
  }
}
