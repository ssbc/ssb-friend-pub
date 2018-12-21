var pull = require('pull-stream')
var sort = require('ssb-sort')

exports.name = 'friendPub'
exports.version = require('./package.json').version
exports.manifest = {
  pubs: 'sync',
  changeHops: 'sync'
}

exports.init = function (sbot, config) {
  sbot.emit('log:info', ['SBOT', 'friend pubs init'])

  if (!sbot.friends || !sbot.friends.hopStream) {
    sbot.emit('log:error', ['SBOT', 'missing sbot.friends.hopStream'])
    return
  }

  var cbs = []
  var dists = {}
  function gotHops(data) {
    for(var k in data) {
      dists[k] = data[k]
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

  let runtimeFriendHops = null
  let pubs = {}
  
  // pull-abortable doesn't work with live streams
  let aborted = [false]

  function calculatePubsWithinFriendHops(abortIndex) {
    pubs = {}

    pull(
      sbot.messagesByType({ live: true, type: 'pub-owner-announce' }),
      pull.drain(announceMsg => {
        if (aborted[abortIndex]) return false
        if (announceMsg.sync) return
        onReady(() => {
          var friendHops = runtimeFriendHops || config.friendPub && config.friendPub.hops || 1
          var hops = dists[announceMsg.value.author]
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
            }

            pull(
              sbot.backlinks.read({
                query: [ {$filter: { dest: announceMsg.key }} ],
                index: 'DTA', // use asserted timestamps
                live: false,
                old: true
              }),
              pull.collect(msgs => {
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

  calculatePubsWithinFriendHops(aborted.length - 1)
  
  return {
    pubs: function() { return pubs },
    changeHops: function(newHops) { // FIXME: maybe cb with pubs
      runtimeFriendHops = newHops

      aborted[aborted.length-1] = true
      aborted.push(false)
      calculatePubsWithinFriendHops(aborted.length - 1)
    }
  }
}
