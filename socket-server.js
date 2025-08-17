const express = require("express")
const { createServer } = require("http")
const { Server } = require("socket.io")
const cors = require("cors")

const app = express()
app.use(cors())

const server = createServer(app)
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "https://your-vercel-app.vercel.app"],
    methods: ["GET", "POST"],
  },
})

let queue = []
const rooms = {}

async function translateMessage(text, fromLanguage, toLanguage) {
  try {
    console.log(`🔄 Translating from ${fromLanguage} to ${toLanguage}`)

    const response = await fetch("https://your-vercel-app.vercel.app/api/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        fromLanguage,
        toLanguage,
      }),
    })

    if (!response.ok) {
      throw new Error(`Translation failed: ${response.status}`)
    }

    const data = await response.json()
    return data.translatedText
  } catch (error) {
    console.error("Translation error:", error)
    return text
  }
}

io.on("connection", (socket) => {
  console.log(`✅ User connected: ${socket.id}`)

  socket.on("joinQueue", (userData) => {
    console.log(`👤 User joining queue:`, userData)

    const existingUserIndex = queue.findIndex((user) => user.username === userData.username)
    if (existingUserIndex !== -1) {
      console.log(`🔄 User ${userData.username} already in queue, updating...`)
      queue[existingUserIndex] = { ...userData, socketId: socket.id }
    } else {
      queue.push({ ...userData, socketId: socket.id })
    }

    console.log(`📊 Queue size: ${queue.length}`)
    console.log(
      `📋 Current queue:`,
      queue.map((u) => u.username),
    )

    if (queue.length >= 2) {
      setTimeout(() => {
        if (queue.length >= 2) {
          const user1 = queue.shift()
          const user2 = queue.shift()

          const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`

          rooms[roomId] = {
            users: [user1, user2],
            languages: {
              [user1.socketId]: user1.language,
              [user2.socketId]: user2.language,
            },
          }

          const user1Socket = io.sockets.sockets.get(user1.socketId)
          const user2Socket = io.sockets.sockets.get(user2.socketId)

          if (user1Socket && user2Socket) {
            user1Socket.join(roomId)
            user2Socket.join(roomId)

            user1Socket.emit("paired", { roomId, partner: user2 })
            user2Socket.emit("paired", { roomId, partner: user1 })

            console.log(`🎯 Paired users: ${user1.username} & ${user2.username} in room ${roomId}`)
          }
        }
      }, 100)
    }
  })

  socket.on("sendMessage", async (data) => {
    const { roomId, message, sender } = data
    const room = rooms[roomId]

    if (room) {
      const senderLanguage = room.languages[socket.id]
      const otherUser = room.users.find((u) => u.socketId !== socket.id)
      const targetLanguage = room.languages[otherUser.socketId]

      socket.to(roomId).emit("receiveMessage", {
        message,
        sender,
        timestamp: new Date().toISOString(),
        isOwn: false,
      })

      if (senderLanguage !== targetLanguage) {
        try {
          const translatedMessage = await translateMessage(message, senderLanguage, targetLanguage)

          socket.to(roomId).emit("receiveTranslation", {
            originalMessage: message,
            translatedMessage,
            fromLanguage: senderLanguage,
            toLanguage: targetLanguage,
            sender,
            timestamp: new Date().toISOString(),
          })

          const ownTranslation = await translateMessage(message, senderLanguage, targetLanguage)
          socket.emit("ownTranslatedMessage", {
            originalMessage: message,
            translatedMessage: ownTranslation,
            toLanguage: targetLanguage,
            timestamp: new Date().toISOString(),
          })
        } catch (error) {
          console.error("Translation failed:", error)
        }
      }
    }
  })

  socket.on("disconnect", () => {
    console.log(`❌ User disconnected: ${socket.id}`)
    queue = queue.filter((user) => user.socketId !== socket.id)

    for (const roomId in rooms) {
      const room = rooms[roomId]
      if (room.users.some((user) => user.socketId === socket.id)) {
        delete rooms[roomId]
        socket.to(roomId).emit("partnerDisconnected")
        break
      }
    }
  })
})

const PORT = process.env.PORT || 3002
server.listen(PORT, () => {
  console.log(`🚀 Socket.io server running on port ${PORT}`)
})
