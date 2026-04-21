const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

mongoose.connect("mongodb://127.0.0.1:27017/chatroom")
.then(() => console.log("MongoDB Connected"))
.catch(err => console.log(err));

const MessageSchema = new mongoose.Schema({
    user: String,
    message: String,
    image: String,   // 🔥 add this
    type: String,    // "text" or "image"
    features: String,
    time: { type: Date, default: Date.now }
});

const Message = mongoose.model("Message", MessageSchema);

app.use(express.static("public"));

function getLocalAIResponse(msg) {
    msg = msg.toLowerCase();

    const responses = {
        hello: ["Hello!", "Hi there!", "Hey!"],
        howareyou: ["I'm doing great!", "All good here!"],
        name: ["I am your local AI assistant"],
        bye: ["Goodbye!", "See you soon!"],
        help: ["Ask me anything!", "I'm here to help!"]
    };

    function random(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    if (msg.includes("hello") || msg.includes("hi")) return random(responses.hello);
    if (msg.includes("how are you")) return random(responses.howareyou);
    if (msg.includes("name")) return random(responses.name);
    if (msg.includes("bye")) return random(responses.bye);
    if (msg.includes("help")) return random(responses.help);

    return "Interesting... tell me more!";
}

io.on("connection", (socket) => {

    console.log("User connected:", socket.id);

    // Load old messages
    Message.find()
    .sort({ time: 1 })
    .then(messages => {
        socket.emit("load messages", messages);
    });

    // Chat message
    socket.on("chat message", async (data) => {
        try {
            if (!data || !data.user || !data.message.trim()) return;

            const newMsg = new Message({
                user: data.user,
                message: data.message
            });

            await newMsg.save();

            io.emit("chat message", newMsg);

            // AI reply
            if (data.user !== "AI") {
                const aiReply = {
                    user: "AI",
                    message: getLocalAIResponse(data.message)
                };

                const aiMsg = new Message(aiReply);
                await aiMsg.save();

                io.emit("chat message", aiMsg);
            }

        } catch (err) {
            console.log("Error:", err);
        }
    });

    

socket.on("send image", async (data, callback) => {
    try {
        const newMsg = new Message({
            user: data.user,
            image: data.image,
            type: "image",
            features: data.features,
            time: new Date()
        });

        await newMsg.save();

        if (typeof callback === "function") {
            callback({ success: true });
        }

        io.emit("receive image", {
            user: data.user,
            image: data.image,
            originalSize: data.originalSize,
            compressedSize: data.compressedSize,
            loss: data.loss,
            mse: data.mse,
            psnr: data.psnr,
            qualityLabel: data.qualityLabel,
            features: data.features
        });

    } catch (err) {
        console.log("Error saving image:", err);
    }
});

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
    });

});

server.listen(3000, "0.0.0.0", () => {
    console.log("Server running on:");
    console.log("Local:   http://localhost:3000");
});