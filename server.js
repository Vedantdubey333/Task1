const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");

ffmpeg.setFfmpegPath(ffmpegStatic);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

mongoose.connect("mongodb://127.0.0.1:27017/chatroom")
.then(() => console.log("MongoDB Connected"))
.catch(err => console.log(err));

const MessageSchema = new mongoose.Schema({
    user: String,
    message: String,
    image: String,
    audio: String,   // Added for audio
    type: String,    // "text", "image", or "audio"
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

    // 🔹 Compress Audio Multi-Bitrate using FFmpeg
    socket.on("compress audio multi", async (data, callback) => {
        try {
            const inputBuffer = Buffer.from(data.base64.split(",")[1], "base64");
            const tempInPath = path.join(__dirname, `temp_in_${socket.id}.webm`);
            const savedDir = path.join(__dirname, "audio_outputs");
            if (!fs.existsSync(savedDir)) fs.mkdirSync(savedDir);

            fs.writeFileSync(tempInPath, inputBuffer);
            const originalSize = fs.statSync(tempInPath).size;

            const bitrates = ['64k', '96k', '128k', '192k'];
            const results = [];

            for (let br of bitrates) {
                await new Promise((resolve, reject) => {
                    const tempOutPath = path.join(__dirname, `temp_out_${socket.id}_${br}.mp3`);
                    const startTime = Date.now();
                    ffmpeg(tempInPath)
                        .output(tempOutPath)
                        .audioBitrate(br)
                        .on('end', () => {
                            const timeTaken = Date.now() - startTime;
                            const compressedBuffer = fs.readFileSync(tempOutPath);
                            const compressedSize = compressedBuffer.length;
                            const compressedBase64 = "data:audio/mp3;base64," + compressedBuffer.toString("base64");
                            
                            // Save named file: audio_64.mp3, audio_96.mp3, etc.
                            const brNum = br.replace('k', '');
                            const savedPath = path.join(savedDir, `audio_${brNum}.mp3`);
                            fs.writeFileSync(savedPath, compressedBuffer);

                            fs.unlinkSync(tempOutPath);
                            
                            results.push({
                                bitrate: br,
                                compressedBase64,
                                compressedSize,
                                timeTaken
                            });
                            resolve();
                        })
                        .on('error', (err) => {
                            console.error('FFmpeg error:', err);
                            if (fs.existsSync(tempOutPath)) fs.unlinkSync(tempOutPath);
                            reject(err);
                        })
                        .run();
                });
            }

            fs.unlinkSync(tempInPath);

            // Print terminal comparison table
            console.log("\n📊 Audio Multi-Bitrate Compression Report");
            console.log("─".repeat(65));
            const header = "Bitrate  | Size (KB) | Compress (ms) | Size Reduction";
            console.log(header);
            console.log("─".repeat(65));
            results.forEach(r => {
                const kb = (r.compressedSize / 1024).toFixed(1).padStart(9);
                const ms = String(r.timeTaken).padStart(13);
                const reduction = (((originalSize - r.compressedSize) / originalSize) * 100).toFixed(1).padStart(14);
                console.log(`${r.bitrate.padEnd(8)} | ${kb} | ${ms} | ${reduction}%`);
            });
            console.log("─".repeat(65));
            console.log(`📁 Saved to: ${savedDir}\n`);

            callback({
                success: true,
                originalSize,
                results
            });

        } catch (err) {
            console.error("Audio compression error:", err);
            callback({ success: false, error: err.message });
        }
    });

    // 🔹 Send Audio
    socket.on("send audio", async (data, callback) => {
        try {
            const newMsg = new Message({
                user: data.user,
                audio: data.audio,
                type: "audio",
                features: data.features,
                time: new Date()
            });

            await newMsg.save();

            if (typeof callback === "function") {
                callback({ success: true });
            }

            io.emit("receive audio", {
                user: data.user,
                audio: data.audio,
                originalSize: data.originalSize,
                compressedSize: data.compressedSize,
                loss: data.loss,
                features: data.features,
                timeTaken: data.timeTaken,
                bitrate: data.bitrate
            });

        } catch (err) {
            console.log("Error saving audio:", err);
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