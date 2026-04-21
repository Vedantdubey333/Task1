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