const socket = io();
const messages = document.getElementById("messages");

let username = "";
let mobilenetModel = null;

// Load ML model
window.addEventListener('load', async () => {
    try {
        console.log("Loading MobileNet model...");
        mobilenetModel = await mobilenet.load({version: 1, alpha: 1.0});
        console.log("MobileNet feature extractor loaded.");
    } catch(e) {
        console.warn("Failed to load feature extractor:", e);
    }
});

// username 
window.onload = () => {
    username = prompt("Enter your name:");
    if (!username) username = "User";
};

// message
function sendMessage() {
    const input = document.getElementById("input");

    if (!input.value.trim()) return;

    socket.emit("chat message", {
        user: username,
        message: input.value
    });

    input.value = "";
}

// old messages
socket.on("load messages", (msgs) => {
    messages.innerHTML = "";

    msgs.forEach((data) => {
        if (data.type === "image") {
            addImage(data);
        } else if (data.type === "audio") {
            addAudio(data);
        } else {
            addMessage(data);
        }
    });
});

// new message
socket.on("chat message", (data) => {
    addMessage(data);
});

async function compressImage(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement("canvas");
                
                // maximum dimensions allowed 
                const MAX_WIDTH = 800;
                let width = img.width;
                let height = img.height;
                
                if (width > MAX_WIDTH) {
                    height = height * (MAX_WIDTH / width);
                    width = MAX_WIDTH;
                }
                
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, width, height);
                
                // Compress as WebP
                const compressedBase64 = canvas.toDataURL("image/webp", 0.7); // 70% quality
                resolve({
                    originalData: event.target.result,
                    compressedData: compressedBase64,
                    width: width,
                    height: height
                });
            };
            img.src = event.target.result;
        };
    });
}

// 🔹 Quality Measurement
async function calculateQualityLoss(originalSrc, compressedSrc, width, height) {
    return new Promise((resolve) => {
        const origImg = new Image();
        const compImg = new Image();
        
        let loaded = 0;
        const onLoad = () => {
            loaded++;
            if (loaded === 2) {
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                
                ctx.drawImage(origImg, 0, 0, width, height);
                const origData = ctx.getImageData(0, 0, width, height).data;
                
                ctx.drawImage(compImg, 0, 0, width, height);
                const compData = ctx.getImageData(0, 0, width, height).data;
                
                let mseTotal = 0;
                for (let i = 0; i < origData.length; i += 4) {
                    const diffR = origData[i] - compData[i];
                    const diffG = origData[i+1] - compData[i+1];
                    const diffB = origData[i+2] - compData[i+2];
                    mseTotal += (diffR * diffR + diffG * diffG + diffB * diffB) / 3;
                }
                
                const numPixels = width * height;
                const mse = numPixels === 0 ? 0 : mseTotal / numPixels;
                
                let psnr = 0;
                if (mse > 0) {
                    psnr = 10 * Math.log10((255 * 255) / mse);
                } else {
                    psnr = 100;
                }
                
                resolve({ mse: mse.toFixed(2), psnr: psnr.toFixed(2) });
            }
        };
        
        origImg.onload = onLoad;
        compImg.onload = onLoad;
        origImg.src = originalSrc;
        compImg.src = compressedSrc;
    });
}

let pendingImageData = null;

function cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 🔹 Feature Extraction
async function extractFeatures(dataUrl) {
    if (!mobilenetModel) return null;
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = async () => {
            const canvas = document.createElement("canvas");
            let width = img.width;
            let height = img.height;
            const MAX = 224;
            
            if (width > MAX || height > MAX) {
                if (width > height) {
                    height = height * (MAX / width);
                    width = MAX;
                } else {
                    width = width * (MAX / height);
                    height = MAX;
                }
            }
            
            canvas.width = Math.round(width);
            canvas.height = Math.round(height);
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            try {
                const embedding = mobilenetModel.infer(canvas, true);
                const arrayData = await embedding.data();
                embedding.dispose();
                
                resolve(Array.from(arrayData));
            } catch (e) {
                console.error(e);
                resolve(null);
            }
        };
        img.src = dataUrl;
    });
}

// 🔹 Preview & Compress
async function previewImage() {
    const fileInput = document.getElementById("imageInput");
    const file = fileInput.files[0];

    if (!file) return;

    const originalSize = file.size;
    const startTime = performance.now();

    const result = await compressImage(file);
    const compressedDataUrl = result.compressedData;
    
    // Measurement
    const metrics = await calculateQualityLoss(result.originalData, compressedDataUrl, result.width, result.height);
    
    // Feature Extraction Original
    const origFeatures = await extractFeatures(result.originalData);
    
    // Feature Extraction Compressed
    const compFeatures = await extractFeatures(compressedDataUrl);

    let featuresStr = "Model not loaded";
    if (origFeatures && compFeatures) {
         let featureSim = cosineSimilarity(origFeatures, compFeatures);
         let featureLoss = 1 - featureSim;
         
         let interpretation = "";
         if (featureSim >= 0.95) interpretation = "Very low loss";
         else if (featureSim >= 0.85) interpretation = "Acceptable";
         else interpretation = "High loss";

         featuresStr = `Sim: ${featureSim.toFixed(4)} | Loss: ${featureLoss.toFixed(4)} (${interpretation})`;
    }
    
    const processTime = performance.now() - startTime;
    
    const base64PrefixLength = compressedDataUrl.indexOf(',') + 1;
    const compressedSize = Math.round((compressedDataUrl.length - base64PrefixLength) * 3 / 4);
    
    const lossPercent = (((originalSize - compressedSize) / originalSize) * 100).toFixed(2);

    let qualityLabel = "High Quality";
    let qualityColor = "#28a745"; // Green
    if (metrics.psnr < 30) {
        qualityLabel = "High Loss";
        qualityColor = "#dc3545"; // Red
    } else if (metrics.psnr < 38) {
        qualityLabel = "Medium Loss";
        qualityColor = "#fd7e14"; // Orange
    }

    // Update UI
    document.getElementById("orig-size").textContent = `(${(originalSize / 1024).toFixed(2)} KB)`;
    document.getElementById("orig-img").src = result.originalData;

    document.getElementById("comp-size").textContent = `(${(compressedSize / 1024).toFixed(2)} KB)`;
    document.getElementById("comp-loss").textContent = lossPercent;
    
    document.getElementById("comp-mse").textContent = metrics.mse;
    document.getElementById("comp-psnr").textContent = metrics.psnr;
    const labelElem = document.getElementById("comp-label");
    labelElem.textContent = qualityLabel;
    labelElem.style.color = qualityColor;
    
    document.getElementById("comp-features").textContent = featuresStr;

    document.getElementById("comp-img").src = compressedDataUrl;

    document.getElementById("image-preview").style.display = "block";

    pendingImageData = {
        base64: compressedDataUrl,
        originalSize,
        compressedSize,
        loss: lossPercent,
        mse: metrics.mse,
        psnr: metrics.psnr,
        qualityLabel,
        features: featuresStr,
        processTime: Math.round(processTime)
    };
}

function cancelSendImage() {
    document.getElementById("image-preview").style.display = "none";
    document.getElementById("imageInput").value = "";
    pendingImageData = null;
}

function confirmSendImage() {
    if (!pendingImageData) return;

    const uploadStartTime = performance.now();

    socket.emit("send image", {
        user: username,
        image: pendingImageData.base64,
        originalSize: pendingImageData.originalSize,
        compressedSize: pendingImageData.compressedSize,
        loss: pendingImageData.loss,
        mse: pendingImageData.mse,
        psnr: pendingImageData.psnr,
        qualityLabel: pendingImageData.qualityLabel,
        features: pendingImageData.features
    }, () => {
        const uploadTime = Math.round(performance.now() - uploadStartTime);
        console.log(`Image uploaded in ${uploadTime}ms`);
    });

    cancelSendImage();
}

// 🔹 Audio Logic

let pendingAudioData = null;

async function extractAudioFeatures(base64) {
    return new Promise((resolve) => {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const binaryStr = atob(base64.split(",")[1]);
            const len = binaryStr.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
            }
            audioCtx.decodeAudioData(bytes.buffer, (buffer) => {
                const channelData = buffer.getChannelData(0); // Float32Array left channel
                
                // We need exactly a power of 2 for Meyda. e.g. 4096.
                const frameSize = 4096;
                let signal = new Float32Array(frameSize);
                
                if (channelData.length >= frameSize) {
                    const start = Math.floor((channelData.length - frameSize) / 2);
                    signal.set(channelData.slice(start, start + frameSize));
                } else {
                    signal.set(channelData);
                }
                
                if (typeof Meyda === 'undefined') {
                    console.warn("Meyda is not loaded.");
                    resolve(null);
                    return;
                }

                Meyda.bufferSize = frameSize;
                Meyda.sampleRate = buffer.sampleRate;
                const mfcc = Meyda.extract('mfcc', signal);
                resolve(mfcc);
            }, (err) => {
                console.error("Audio decode error", err);
                resolve(null);
            });
        } catch(e) {
            console.error("Feature extraction failed", e);
            resolve(null);
        }
    });
}

function previewAudio() {
    const fileInput = document.getElementById("audioInput");
    const file = fileInput.files[0];
    if (!file) return;

    // Size limit 5MB
    if (file.size > 5 * 1024 * 1024) {
        alert("Audio file too large. Max 5MB allowed.");
        fileInput.value = "";
        return;
    }

    const originalSize = file.size;
    document.getElementById("orig-audio-size").textContent = `(${(originalSize / 1024).toFixed(2)} KB)`;

    const reader = new FileReader();
    reader.onload = (event) => {
        const origBase64 = event.target.result;
        document.getElementById("orig-audio-element").src = origBase64;
        
        document.getElementById("audio-preview").style.display = "block";
        document.getElementById("audio-loading").style.display = "block";
        document.getElementById("audio-result-area").style.display = "none";
        document.getElementById("audio-confirm-btn").style.display = "none";
        
        // Emit to server to compress multiple bitrates
        socket.emit("compress audio multi", { base64: origBase64 }, async (response) => {
            document.getElementById("audio-loading").style.display = "none";
            
            if (!response.success) {
                alert("Audio compression failed: " + response.error);
                cancelSendAudio();
                return;
            }

            const origFeatures = await extractAudioFeatures(origBase64);
            const tbody = document.getElementById("audio-cmp-body");
            tbody.innerHTML = "";

            let tableData = [];
            let bestPick  = null;
            let audioMap  = {};
            const maxSize = Math.max(...response.results.map(r => r.compressedSize));

            document.getElementById("comp-audio-element").src = "";
            pendingAudioData = null;

            // Colour tiers by similarity
            function rowColor(sim) {
                if (sim >= 0.95) return { bg: "#edfdf4", dot: "#23a55a" }; // green
                if (sim >= 0.88) return { bg: "#eff6ff", dot: "#3b82f6" }; // blue
                if (sim >= 0.75) return { bg: "#fffbeb", dot: "#f59e0b" }; // amber
                return { bg: "#fef2f2", dot: "#ef4444" };                  // red
            }

            for (let i = 0; i < response.results.length; i++) {
                const res = response.results[i];
                const compFeatures = await extractAudioFeatures(res.compressedBase64);

                let featureSim  = 0;
                let featureLoss = 1;
                if (origFeatures && compFeatures) {
                    featureSim  = cosineSimilarity(origFeatures, compFeatures);
                    featureLoss = 1 - featureSim;
                }

                // Simulated transmission @ 500 KB/s broadband
                const transTime  = (res.compressedSize / 1024) / 500 * 1000;
                const lossPercent = (((originalSize - res.compressedSize) / originalSize) * 100).toFixed(2);

                tableData.push({
                    "Bitrate":        res.bitrate,
                    "Size (KB)":      Math.round(res.compressedSize / 1024),
                    "Trans Time (ms)": Math.round(transTime),
                    "Similarity":     featureSim.toFixed(4),
                    "Feature Loss":   featureLoss.toFixed(4)
                });

                audioMap[res.bitrate] = {
                    base64:        res.compressedBase64,
                    originalSize,
                    compressedSize: res.compressedSize,
                    loss:           lossPercent,
                    features:       `Sim: ${featureSim.toFixed(4)} | Loss: ${featureLoss.toFixed(4)}`,
                    timeTaken:      res.timeTaken,
                    bitrate:        res.bitrate
                };

                // Best pick: first bitrate with similarity >= 0.88
                if (!bestPick && featureSim >= 0.88) bestPick = res.bitrate;
            }

            // === Terminal comparison table (matches spec) ===
            console.log("\n%c📊 Audio Bitrate Comparison Table", "font-weight:bold;font-size:14px;color:#5865f2");
            console.table(tableData);

            // Fallback if nothing hit threshold
            if (!bestPick && response.results.length > 0)
                bestPick = response.results[response.results.length - 1].bitrate;

            // Recommendation card
            const recCard = document.getElementById("rec-card");
            const recSpan = document.getElementById("audio-recommendation");
            if (bestPick) {
                const best = audioMap[bestPick];
                recSpan.textContent =
                    `${bestPick} is optimal — ${(best.compressedSize / 1024).toFixed(1)} KB payload ` +
                    `with similarity ${best.features.split("|")[0].trim().replace("Sim: ", "")}. ` +
                    `Best trade-off for real-time systems.`;
                recCard.style.display = "block";
            }

            // Build table rows
            tableData.forEach((row, idx) => {
                const res   = response.results[idx];
                const isBest = row.Bitrate === bestPick;
                const sim   = parseFloat(row.Similarity);
                const { bg, dot } = rowColor(sim);
                const bwPct = Math.round((res.compressedSize / maxSize) * 100);

                const tr = document.createElement("tr");
                tr.className = isBest ? "best-row" : "";
                tr.style.background = bg;
                tr.dataset.bitrate = row.Bitrate;
                tr.style.cursor = "pointer";

                tr.innerHTML = `
                    <td>
                        <input type="radio" name="audio-bitrate" value="${row.Bitrate}"
                               ${isBest ? "checked" : ""}
                               onchange="selectAudioBitrate(this.value)">
                    </td>
                    <td style="font-weight:600;">
                        <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${dot};margin-right:5px;"></span>
                        ${row.Bitrate}${isBest ? ' <span class="badge badge-best">✦ Best</span>' : ""}
                    </td>
                    <td>${row["Size (KB)"]}</td>
                    <td>${row["Trans Time (ms)"]}</td>
                    <td style="font-weight:600;">${row.Similarity}</td>
                    <td style="color:${sim >= 0.88 ? "var(--success)" : "var(--danger)"};">${row["Feature Loss"]}</td>
                    <td>
                        <div class="bw-bar-wrap">
                            <div class="bw-bar-bg">
                                <div class="bw-bar-fill" style="width:${bwPct}%;background:${dot};"></div>
                            </div>
                            <span>${bwPct}%</span>
                        </div>
                    </td>
                `;

                // Row click also selects
                tr.addEventListener("click", () => {
                    tr.querySelector("input[type=radio]").checked = true;
                    document.querySelectorAll("#audio-cmp-body tr").forEach(r => r.classList.remove("selected-row"));
                    tr.classList.add("selected-row");
                    selectAudioBitrate(row.Bitrate);
                });

                tbody.appendChild(tr);
            });

            window._audioMultiMap = audioMap;

            if (bestPick) selectAudioBitrate(bestPick);

            document.getElementById("audio-result-area").style.display = "block";
            document.getElementById("audio-confirm-btn").style.display  = "inline-block";
        });
    };
    reader.readAsDataURL(file);
}

function selectAudioBitrate(bitrate) {
    if (window._audioMultiMap && window._audioMultiMap[bitrate]) {
        pendingAudioData = window._audioMultiMap[bitrate];
        document.getElementById("comp-audio-element").src = pendingAudioData.base64;
    }
}

function cancelSendAudio() {
    document.getElementById("audio-preview").style.display = "none";
    document.getElementById("audioInput").value = "";
    document.getElementById("orig-audio-element").src = "";
    document.getElementById("comp-audio-element").src = "";
    pendingAudioData = null;
}

function confirmSendAudio() {
    if (!pendingAudioData) return;
    socket.emit("send audio", {
        user: username,
        audio: pendingAudioData.base64,
        originalSize: pendingAudioData.originalSize,
        compressedSize: pendingAudioData.compressedSize,
        loss: pendingAudioData.loss,
        features: pendingAudioData.features,
        timeTaken: pendingAudioData.timeTaken,
        bitrate: pendingAudioData.bitrate
    });
    cancelSendAudio();
}

// Image
socket.on("receive image", (data) => {
    addImage(data);
});

function addImage(data) {
    const li = document.createElement("li");

    styleMessage(li, data.user);
    
    const renderStartTime = performance.now();

    const title = document.createElement("b");
    title.textContent = `${data.user}:`;
    li.appendChild(title);
    li.appendChild(document.createElement("br"));

    const img = new Image();
    // Use progressive/lazy loading
    img.loading = "lazy";
    img.style.maxWidth = "200px";
    img.style.borderRadius = "8px";
    img.style.marginTop = "5px";

    img.onload = () => {
        const renderTime = (performance.now() - renderStartTime).toFixed(1);
        
        let fileMetrics = `Size: ${(data.compressedSize / 1024 || 0).toFixed(2)} KB`;
        if (data.loss) {
            fileMetrics += ` (-${data.loss}%)`;
        }
        fileMetrics += ` | Rendered in ${renderTime}ms`;
        
        if (data.psnr && data.mse) {
            fileMetrics += `\nQuality: ${data.qualityLabel || 'N/A'} (PSNR: ${data.psnr}dB, MSE: ${data.mse})`;
        }
        
        if (data.features) {
            fileMetrics += `\nFeature Analysis: ${data.features}`;
        }

        const info = document.createElement("div");
        info.style.fontSize = "0.75em";
        info.style.color = data.user === username ? "#d1ecf1" : "#6c757d";
        info.style.marginTop = "4px";
        info.style.whiteSpace = "pre-line"; // Allow newlines
        info.textContent = fileMetrics;
        
        li.appendChild(info);
        messages.scrollTop = messages.scrollHeight;
    };
    
    // Check if it's new format or old base64
    if (data.image && data.image.startsWith("data:image")) {
        img.src = data.image; 
    } else {
        img.src = "data:image/jpeg;base64," + (data.original || data.image);
    }

    li.appendChild(img);

    messages.appendChild(li);
    messages.scrollTop = messages.scrollHeight;
}

socket.on("receive audio", (data) => {
    addAudio(data);
});

function addAudio(data) {
    const li = document.createElement("li");

    styleMessage(li, data.user);
    
    const title = document.createElement("b");
    title.textContent = `${data.user}:`;
    li.appendChild(title);
    li.appendChild(document.createElement("br"));

    const audio = document.createElement("audio");
    audio.controls = true;
    audio.style.width = "250px";
    audio.style.height = "40px";
    audio.style.marginTop = "5px";
    audio.src = data.audio; // 64kbps mp3 base64
    li.appendChild(audio);
    
    let fileMetrics = `Codec: ${data.bitrate || 'Unknown'} MP3 | Size: ${(data.compressedSize / 1024 || 0).toFixed(2)} KB`;
    if (data.loss) {
        fileMetrics += ` (-${data.loss}%)`;
    }
    if (data.timeTaken) {
        fileMetrics += ` | Compressed in ${data.timeTaken}ms`;
    }
    
    if (data.features) {
        fileMetrics += `\nLoss Analysis: ${data.features}`;
    }

    const info = document.createElement("div");
    info.style.fontSize = "0.75em";
    info.style.color = data.user === username ? "#d1ecf1" : "#6c757d";
    info.style.marginTop = "4px";
    info.style.whiteSpace = "pre-line"; 
    info.textContent = fileMetrics;
    
    li.appendChild(info);
    messages.appendChild(li);
    messages.scrollTop = messages.scrollHeight;
}

// Message UI
function addMessage(data) {
    const li = document.createElement("li");

    styleMessage(li, data.user);

    li.textContent = `${data.user}: ${data.message}`;

    messages.appendChild(li);
    messages.scrollTop = messages.scrollHeight;
}

// Styling Logic 
function styleMessage(li, user) {
    if (user === username) {
        li.style.background = "#0084ff";
        li.style.color = "white";
        li.style.textAlign = "right";
    } 
    else if (user === "AI") {
        li.style.background = "#28a745";
        li.style.color = "white";
    } 
    else {
        li.style.background = "#e4e6eb";
    }
}

document.getElementById("input").addEventListener("keypress", function(e) {
    if (e.key === "Enter") {
        sendMessage();
    }
});