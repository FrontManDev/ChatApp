require("dotenv").config();

const express = require("express");
const path = require("path");
const app = express();
const { PrismaClient } = require("@prisma/client");
const { execSync } = require('child_process');
const prisma = new PrismaClient();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const TokenKey = process.env.JWT_SECRET;
const Time = process.env.JWT_EXPIRES_IN;
const http = require('http');
const { Server } = require('socket.io');
const server = http.createServer(app);
const io = new Server(server);

try {
  console.log("Applying database migrations...");
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
  console.log("Migrations applied successfully.");
} catch (error) {
  console.error("Error applying migrations:", error.message);
  process.exit(1);
}

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  socket.on('join', (userId) => {
    socket.join(userId);
    console.log(`User ${userId} joined their room`);
  });

  socket.on('sendMessage', async ({ senderId, receiverId, content }) => {
    try {
      const message = await prisma.message.create({
        data: {
          content,
          senderId,
          receiverId
        },
        include: {
          sender: {
            select: {
              firstName: true
            }
          },
          receiver: {
            select: {
              firstName: true
            }
          }
        }
      });
      
      io.to(receiverId).emit('receiveMessage', {
        id: message.id,
        content: message.content,
        senderId: message.senderId,
        senderName: message.sender.firstName,
        receiverId: message.receiverId,
        receiverName: message.receiver.firstName,
        createdAt: message.createdAt
      });
      
      socket.emit('messageSent', {
        id: message.id,
        content: message.content,
        senderId: message.senderId,
        receiverId: message.receiverId,
        createdAt: message.createdAt
      });
    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('error', 'Failed to send message');
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

app.get("/", (req, res) => {
  res.render("index", { title: "Home Page" });
});

app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Enter all the fields" });
    }
    
    const User = await prisma.user.findUnique({ where: { email } });
    if (!User) {
      return res.status(400).json({ message: "Incorrect email or password" });
    }
    
    const isMatch = await bcrypt.compare(password, User.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Incorrect email or password" });
    }
    
    const Token = jwt.sign({ id: User.id, email: User.email }, TokenKey, {
      expiresIn: Time,
    });
    
    return res.status(200).json({
      message: "User successfully logged in",
      Token,
      User: {
        id: User.id,
        firstName: User.firstName
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Error in server", error: error.message });
  }
});

app.get("/register", (req, res) => {
  res.render("register");
});

app.get("/chat/:id", async (req, res) => {
  try {
    const currentUserId = req.params.id; 
    const users = await prisma.user.findMany({ 
      where: { id: { not: currentUserId } }
    });
    res.render("chat", { users });
  } catch (error) {
    console.error("Server Error:", error);
    res.status(500).json({ message: "Error in server" });
  }
});

app.get('/messages/:senderId/:receiverId', async (req, res) => {
  try {
    const { senderId, receiverId } = req.params;
    
    const messages = await prisma.message.findMany({
      where: {
        OR: [
          {
            senderId: senderId,
            receiverId: receiverId
          },
          {
            senderId: receiverId,
            receiverId: senderId
          }
        ]
      },
      include: {
        sender: {
          select: {
            firstName: true
          }
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });
    
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ message: 'Error fetching messages' });
  }
});

app.get('/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany();
    res.status(200).json({ message: "All the users", users });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/register", async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ message: "Enter all the fields" });
    }
    
    const hashpassword = await bcrypt.hash(password, 10);
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: "This email is already in use" });
    }
    
    const newUser = await prisma.user.create({
      data: { firstName, lastName, email, password: hashpassword },
    });
    
    const Token = jwt.sign({ id: newUser.id, email: newUser.email }, TokenKey, {
      expiresIn: Time,
    });
    
    res.status(201).json({ 
      message: "User registered successfully", 
      User: newUser, 
      Token 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/delete", async (req, res) => {
  try {
    const deletedUsers = await prisma.user.deleteMany();
    if (deletedUsers.count === 0) {
      return res.status(400).json({ message: "No users were deleted." });
    }
    return res.status(200).json({
      message: "All users have been deleted.",
      count: deletedUsers.count,
    });
  } catch (error) {
    return res.status(500).json({ 
      message: "Server error", 
      error: error.message 
    });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});