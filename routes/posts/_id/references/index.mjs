import { CurrentUser, Followers, ValidateData, AutoTags, GenerateNotice, EmitBackgroundNotice } from "../../../../lib.mjs"

const postRules = {
  text: {
    // required: true,
    maxLength: 2000,
    isHTML: true
  }
}

export default async function (fastify, opts) {
  fastify.get('/count', async (req, reply) => {
    let ret = null

    try {
      const email = await fastify.cognito.checkSignIn(fastify, req.headers)
      if (!email) {
        // throw new Error('Invalid Token')
      }

      let currentUser
      if (email) {
        currentUser = await CurrentUser(fastify, email)
      }

      const post = await fastify.mongo.db
        .collection('Posts')
        .findOne({
          _id: new fastify.mongo.ObjectId(req.params.id),
          deleted: { $ne: true }
        })

      if (!post) {
        throw new Error('Not Found Post')
      }

      ret = await fastify.mongo.db
        .collection('Posts')
        .find({
          refId: post._id,
          // deleted: { $ne: true }
        })
        .count()
    } catch (err) {
      console.error(err)
      throw boom.boomify(err)
    }

    return ret
  }),
  fastify.post('/', async (req, reply) => {
    let ret = {}

    try {
      const email = await fastify.cognito.checkSignIn(fastify, req.headers)
      if (!email) {
        throw new Error('Invalid Token')
      }

      const currentUser = await CurrentUser(fastify, email)
      if (!currentUser) {
        throw new Error('Not Found User')
      }

      const post = await fastify.mongo.db
        .collection('Posts')
        .findOne({
          _id: new fastify.mongo.ObjectId(req.params.id),
          deleted: { $ne: true }
        })

      if (!post) {
        throw new Error('Not Found Data')
      }

      const [isValid, incorrects, data] = ValidateData(req.body, postRules)
      if (!isValid) {
        throw new Error(`Incorrect Parameters - ${incorrects.join(',')}`)
      }

      if (data.text) {
        const tags = AutoTags(data.text)
        if (tags.length > 0) {
          data.tags = tags
        }
      }

      data.refId = post._id

      data.postedAt = new Date()
      data.postedBy = currentUser._id

      const inserted = await fastify.mongo.db
        .collection('Posts')
        .insertOne(data)

      ret._id = inserted.insertedId

      const toUserIds = await Followers(fastify, currentUser)
      await GenerateNotice(fastify, req, 'reference', currentUser._id, toUserIds, ret._id)

      await GenerateNotice(fastify, req, 'referenced', currentUser._id, [post.postedBy], ret._id)

      await EmitBackgroundNotice(fastify,
        'referenced',
        {
          postId: post._id,
          userId: currentUser._id
        }
      )

    } catch (err) {
      console.error(err)
      reply.code(400).send(err)
      return
    }

    return ret
  })
}
