A module for [scuttlebot](https://github.com/ssbc/scuttlebot) that
interprets pub owner announcements and presents a list of pubs run by
your friends or within a certain amount of hops.

Message types for owner of pub:
 - { type: 'pub-owner-announce', pub: '@id' }
 - { type: 'pub-owner-retract', announce: '%id' }

Message types for pub:
 - { type: 'pub-owner-confirm', announce: '%id', address: "xyz.onion", features: ["tor", "incoming-guard"] }
 - { type: 'pub-owner-reject', announce: '%id' } // optional
