const test = require('tape')
const Server = require('scuttle-testbot')
const ssbKeys = require('ssb-keys')
const pull = require('pull-stream')

const keyMe = ssbKeys.generate()
const keyPub = ssbKeys.generate()

Server.use(require('ssb-backlinks'))
  .use(require('scuttlebot/plugins/replicate'))
  .use(require('ssb-friends'))
  .use(require('..'))

test('basic case, announce + confirm', t => {
  const server = Server({name: 'test.announce', keys: keyMe})

  var me = server.createFeed(keyMe)
  var pub = server.createFeed(keyPub)
  
  const announce = { type: 'pub-owner-announce', id: keyPub.id }

  me.add(announce, (err, announceMsg) => {
    if (err) console.error(err)

    const confirm = { type: 'pub-owner-confirm', message: announceMsg.key,
                      address: "4fqstkswahy3n7mupr2gvvp2qcsp6juwzn3mnqvhkaixxepvxrrtfbid.onion",
                      features: ["tor", "incoming-guard"] }
    
    pub.add(confirm, (err) => {
      if (err) console.error(err)

      const reject = { type: 'pub-owner-retract', msg: announceMsg.key }
      // pub gets hacked or is no longer running
      me.add(reject, (err, rejectMsg) => {
        if (err) console.error(err)

        setTimeout(() => {
          t.equal(Object.keys(server.friendPub.pubs()).length, 0, "0 pubs available")
          t.end()
          server.close()
        }, 500)
      })
    })
  })
})

