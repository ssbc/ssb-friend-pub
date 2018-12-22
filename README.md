A module for [scuttlebot](https://github.com/ssbc/scuttlebot) that
interprets pub owner announcements and presents a list of pubs run by
your friends or within a certain number of hops.

One way to run this, is to install it on your machine and set
`friendPub.hops` to 1. Meaning only replicate with pubs run by me or
my friends. Then install it on your pub and set the same config
to 2. This way your pub will replicate to the same pubs that you
replicate, and won't start replicating to random pubs.

FIXME: integrate this with sbot to overwrite default gossiping

Please note that this does *not* guarantee that your messages will not
be gossipped outside your friends, as any node not running this module
will connect to random pubs they have encountered. But it does give
you some level of control and also this will prioritise messages to
your friends assuming they connect to their pubs more often that other
pubs.

Message types for owner of pub:
 - { type: 'pub-owner-announce', pub: '@id' }
 - { type: 'pub-owner-retract', announcement: '%id' }

Message types for pub:
 - { type: 'pub-owner-confirm', announcement: '%id', address: "xyz.onion", features: ["tor", "incoming-guard"] }
 - { type: 'pub-owner-reject', announcement: '%id' } // to reject a confirm later on

This can be combined with the
[ssb-incoming-guard](https://github.com/ssbc/ssb-incoming-guard)
module.
