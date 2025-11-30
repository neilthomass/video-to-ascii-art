// Output storage utilities (shared with app.js)
const OutputStorage = {
    STORAGE_KEY: 'ascii_video_outputs',

    getAll() {
        try {
            const data = localStorage.getItem(this.STORAGE_KEY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('Failed to load outputs from storage:', e);
            return [];
        }
    },

    getById(id) {
        const outputs = this.getAll();
        return outputs.find(o => o.id === id);
    },

    formatDate(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const jsonFileInput = document.getElementById('jsonFile');
    const loadingStatus = document.getElementById('loadingStatus');
    const errorDiv = document.getElementById('error');
    const errorMessage = document.getElementById('errorMessage');
    const playerContainer = document.getElementById('playerContainer');
    const videoFrame = document.getElementById('videoFrame');
    const playBtn = document.getElementById('playBtn');
    const timeline = document.getElementById('timeline');
    const timeDisplay = document.getElementById('timeDisplay');
    const videoInfo = document.getElementById('videoInfo');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const rerenderBtn = document.getElementById('rerenderBtn');
    const charsInput = document.getElementById('chars');
    const charsGroup = document.getElementById('charsGroup');
    const savedOutputsSection = document.getElementById('savedOutputsSection');
    const savedOutputsSelect = document.getElementById('savedOutputs');
    const modeAsciiBtn = document.getElementById('modeAscii');
    const modeDotsBtn = document.getElementById('modeDots');

    let videoData = null;
    let renderedFrames = null;
    let currentFrame = 0;
    let isPlaying = false;
    let animationId = null;
    let lastFrameTime = 0;
    let renderMode = 'ascii'; // 'ascii' or 'dots'

    // Populate saved outputs dropdown
    function populateSavedOutputs() {
        const outputs = OutputStorage.getAll();

        if (outputs.length === 0) {
            savedOutputsSection.classList.add('hidden');
            return;
        }

        savedOutputsSection.classList.remove('hidden');
        savedOutputsSelect.innerHTML = '<option value="">-- Choose a saved output --</option>';

        outputs.forEach(output => {
            const option = document.createElement('option');
            option.value = output.id;
            option.textContent = `${output.name} (${output.dimensions}, ${OutputStorage.formatDate(output.timestamp)})`;
            savedOutputsSelect.appendChild(option);
        });
    }

    // Load from URL parameter
    function loadFromUrlParam() {
        const urlParams = new URLSearchParams(window.location.search);
        const outputId = urlParams.get('output');

        if (outputId) {
            const output = OutputStorage.getById(outputId);
            if (output && output.data) {
                loadFromSavedOutput(output);
                savedOutputsSelect.value = outputId;
            }
        }
    }

    // Load from saved output
    async function loadFromSavedOutput(output) {
        hideError();
        playerContainer.classList.add('hidden');
        loadingStatus.classList.remove('hidden');
        loadingStatus.textContent = 'Loading saved output...';

        try {
            // Decode base64 to binary
            const binaryString = atob(output.data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: 'application/gzip' });

            loadingStatus.textContent = 'Decompressing...';
            const text = await decompressGzip(blob);

            loadingStatus.textContent = 'Parsing JSONL...';
            const data = parseJsonl(text);

            loadingStatus.textContent = 'Validating format...';
            const validationError = validateFormat(data);
            if (validationError) {
                showError(validationError);
                return;
            }

            videoData = data;

            loadingStatus.textContent = `Pre-rendering ${data.metadata.frameCount} frames...`;
            await new Promise(r => setTimeout(r, 10));

            prerenderFrames();

            timeline.max = renderedFrames.length - 1;
            timeline.value = 0;
            currentFrame = 0;

            const duration = data.metadata.duration || (data.metadata.frameCount / data.metadata.fps);
            videoInfo.textContent = `${data.metadata.width}x${data.metadata.height} chars | ${data.metadata.fps} fps | ${data.metadata.frameCount} frames | ${formatTime(duration)}`;

            loadingStatus.classList.add('hidden');
            playerContainer.classList.remove('hidden');

            calculateFontSize();
            showFrame(0);
            playBtn.textContent = 'Play';
            isPlaying = false;

        } catch (err) {
            showError(`Failed to load saved output: ${err.message}`);
        }
    }

    // Handle saved outputs dropdown change
    savedOutputsSelect.addEventListener('change', async () => {
        const outputId = savedOutputsSelect.value;
        if (!outputId) return;

        const output = OutputStorage.getById(outputId);
        if (output && output.data) {
            // Update URL without reload
            const url = new URL(window.location);
            url.searchParams.set('output', outputId);
            window.history.pushState({}, '', url);

            await loadFromSavedOutput(output);
        }
    });

    // Initialize
    populateSavedOutputs();
    loadFromUrlParam();

    function showError(message) {
        errorDiv.classList.remove('hidden');
        errorMessage.textContent = message;
        playerContainer.classList.add('hidden');
        loadingStatus.classList.add('hidden');
    }

    function hideError() {
        errorDiv.classList.add('hidden');
    }

    function isRleItem(item) {
        if (!Array.isArray(item) || item.length !== 2) return false;
        const [first, second] = item;
        if (typeof first === 'number' && first > 1 && (second === "" || typeof second === 'number' || Array.isArray(second))) {
            return true;
        }
        return false;
    }

    function rleDecodeFlat(encoded) {
        const decoded = [];
        for (const item of encoded) {
            if (isRleItem(item)) {
                const [count, pixel] = item;
                for (let i = 0; i < count; i++) {
                    decoded.push(pixel);
                }
            } else {
                decoded.push(item);
            }
        }
        return decoded;
    }

    function unflattenFrame(flat, width, height) {
        const frame = [];
        for (let y = 0; y < height; y++) {
            frame.push(flat.slice(y * width, (y + 1) * width));
        }
        return frame;
    }

    function parseJsonl(text) {
        const lines = text.trim().split('\n');
        if (lines.length < 2) {
            throw new Error('JSONL file must have at least metadata and one frame');
        }

        const metadata = JSON.parse(lines[0]);
        const frames = [];
        const useRle = metadata.rle === true;
        const width = metadata.width;
        const height = metadata.height;

        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim()) {
                let frame = JSON.parse(lines[i]);
                if (useRle) {
                    if (Array.isArray(frame) && frame.length > 0 && !Array.isArray(frame[0]?.[0])) {
                        const decoded = rleDecodeFlat(frame);
                        frame = unflattenFrame(decoded, width, height);
                    } else {
                        frame = frame.map(row => rleDecodeFlat(row));
                    }
                }
                frames.push(frame);
            }
        }

        return { metadata, frames };
    }

    function calculateFontSize() {
        const isFullscreen = !!document.fullscreenElement;
        const containerWidth = playerContainer.clientWidth - (isFullscreen ? 40 : 10);
        const containerHeight = isFullscreen ? playerContainer.clientHeight - 100 : Infinity;

        const charWidth = videoData.metadata.width;
        const charHeight = videoData.metadata.height;

        const maxFontByWidth = containerWidth / (charWidth * 0.6);
        const maxFontByHeight = containerHeight / charHeight;

        const maxFontSize = Math.min(maxFontByWidth, maxFontByHeight);
        const fontSize = isFullscreen ? maxFontSize : Math.min(maxFontSize, 14);
        videoFrame.style.fontSize = fontSize + 'px';
    }

    function validateFormat(data) {
        if (!data || typeof data !== 'object') {
            return 'Invalid data structure';
        }

        const metadata = data.metadata;
        if (!metadata || typeof metadata !== 'object') {
            return 'Missing or invalid metadata';
        }

        const { fps, width, height, frameCount } = metadata;

        if (typeof fps !== 'number' || fps <= 0) {
            return 'Invalid or missing fps in metadata';
        }

        if (typeof width !== 'number' || width <= 0) {
            return 'Invalid or missing width in metadata';
        }

        if (typeof height !== 'number' || height <= 0) {
            return 'Invalid or missing height in metadata';
        }

        if (typeof frameCount !== 'number' || frameCount <= 0) {
            return 'Invalid or missing frameCount in metadata';
        }

        if (!Array.isArray(data.frames)) {
            return 'Missing or invalid frames array';
        }

        if (data.frames.length !== frameCount) {
            return `Frame count mismatch: expected ${frameCount}, got ${data.frames.length}`;
        }

        if (data.frames.length > 0) {
            const firstFrame = data.frames[0];
            if (!Array.isArray(firstFrame)) {
                return 'Invalid frame structure: frames should be 2D arrays';
            }
        }

        return null;
    }

    function escapeHtml(char) {
        if (char === '<') return '&lt;';
        if (char === '>') return '&gt;';
        if (char === '&') return '&amp;';
        return char;
    }

    function getBrightness(r, g, b) {
        return 0.299 * r + 0.587 * g + 0.114 * b;
    }

    function getCharForBrightness(brightness, asciiChars, whiteThreshold = 240) {
        if (brightness >= whiteThreshold) {
            return ' ';
        }
        let charIndex = Math.floor((brightness / whiteThreshold) * (asciiChars.length - 1));
        charIndex = Math.min(charIndex, asciiChars.length - 2);
        return asciiChars[charIndex];
    }

    function parsePixel(pixel, asciiChars) {
        if (pixel === "" || pixel === null) {
            return { char: ' ', color: "rgb(255,255,255)" };
        }
        if (typeof pixel === 'number') {
            const char = getCharForBrightness(pixel, asciiChars);
            return { char, color: `rgb(${pixel},${pixel},${pixel})` };
        }
        if (Array.isArray(pixel)) {
            if (pixel.length === 3 && typeof pixel[0] === 'number') {
                const brightness = getBrightness(pixel[0], pixel[1], pixel[2]);
                const char = getCharForBrightness(brightness, asciiChars);
                return { char, color: `rgb(${pixel[0]},${pixel[1]},${pixel[2]})` };
            }
            const [char, colorData] = pixel;
            if (typeof colorData === 'number') {
                return { char, color: `rgb(${colorData},${colorData},${colorData})` };
            }
            if (Array.isArray(colorData)) {
                return { char, color: `rgb(${colorData[0]},${colorData[1]},${colorData[2]})` };
            }
            if (colorData === "") {
                return { char, color: "rgb(255,255,255)" };
            }
            return { char, color: colorData };
        }
        return { char: ' ', color: "rgb(255,255,255)" };
    }

    function getDotChar(brightness) {
        // Use unicode circles of varying sizes based on brightness
        // Darker = larger dot, lighter = smaller dot or space
        if (brightness >= 240) return ' ';
        if (brightness >= 200) return '·';  // small dot
        if (brightness >= 160) return '•';  // bullet
        if (brightness >= 120) return '●';  // black circle
        if (brightness >= 80) return '◉';   // fisheye
        return '⬤';  // large circle
    }

    function prerenderFrames() {
        renderedFrames = [];
        const asciiChars = charsInput.value || 'F$V* ';
        const useDots = renderMode === 'dots';

        for (let f = 0; f < videoData.frames.length; f++) {
            const frame = videoData.frames[f];
            const lines = [];

            for (let y = 0; y < frame.length; y++) {
                const row = frame[y];
                let lineHtml = '';
                let currentColor = null;
                let currentChars = '';

                for (let x = 0; x < row.length; x++) {
                    const { char, color } = parsePixel(row[x], asciiChars);

                    // In dots mode, convert to dot character based on brightness
                    let displayChar = char;
                    if (useDots) {
                        const pixel = row[x];
                        let brightness = 255;
                        if (pixel === '' || pixel === null) {
                            brightness = 255;
                        } else if (typeof pixel === 'number') {
                            brightness = pixel;
                        } else if (Array.isArray(pixel) && pixel.length === 3) {
                            brightness = getBrightness(pixel[0], pixel[1], pixel[2]);
                        }
                        displayChar = getDotChar(brightness);
                    }

                    if (color === currentColor) {
                        currentChars += escapeHtml(displayChar);
                    } else {
                        if (currentChars.length > 0) {
                            lineHtml += `<span style="color:${currentColor}">${currentChars}</span>`;
                        }
                        currentColor = color;
                        currentChars = escapeHtml(displayChar);
                    }
                }

                if (currentChars.length > 0) {
                    lineHtml += `<span style="color:${currentColor}">${currentChars}</span>`;
                }

                lines.push(lineHtml);
            }

            renderedFrames.push(lines.join('\n'));
        }
    }

    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    function updateTimeDisplay() {
        const currentTime = currentFrame / videoData.metadata.fps;
        const totalTime = videoData.metadata.duration || (videoData.metadata.frameCount / videoData.metadata.fps);
        timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(totalTime)}`;
    }

    function showFrame(index) {
        if (index < 0 || index >= renderedFrames.length) return;
        currentFrame = index;
        videoFrame.innerHTML = renderedFrames[currentFrame];
        timeline.value = currentFrame;
        updateTimeDisplay();
    }

    function play() {
        if (isPlaying) return;
        isPlaying = true;
        playBtn.textContent = 'Pause';
        lastFrameTime = performance.now();
        animate();
    }

    function pause() {
        isPlaying = false;
        playBtn.textContent = 'Play';
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
    }

    function animate() {
        if (!isPlaying) return;

        const now = performance.now();
        const frameDuration = 1000 / videoData.metadata.fps;
        const elapsed = now - lastFrameTime;

        if (elapsed >= frameDuration) {
            const framesToAdvance = Math.floor(elapsed / frameDuration);
            let nextFrame = currentFrame + framesToAdvance;

            if (nextFrame >= renderedFrames.length) {
                nextFrame = 0;
            }

            showFrame(nextFrame);
            lastFrameTime = now - (elapsed % frameDuration);
        }

        animationId = requestAnimationFrame(animate);
    }

    async function decompressGzip(blob) {
        const decompressedStream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
        const decompressedBlob = await new Response(decompressedStream).blob();
        return await decompressedBlob.text();
    }

    jsonFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Clear URL parameter when loading from file
        const url = new URL(window.location);
        url.searchParams.delete('output');
        window.history.pushState({}, '', url);
        savedOutputsSelect.value = '';

        hideError();
        playerContainer.classList.add('hidden');
        loadingStatus.classList.remove('hidden');
        loadingStatus.textContent = 'Loading file...';

        try {
            loadingStatus.textContent = 'Decompressing...';
            const text = await decompressGzip(file);
            loadingStatus.textContent = 'Parsing JSONL...';

            const data = parseJsonl(text);

            loadingStatus.textContent = 'Validating format...';
            const validationError = validateFormat(data);
            if (validationError) {
                showError(validationError);
                return;
            }

            videoData = data;

            loadingStatus.textContent = `Pre-rendering ${data.metadata.frameCount} frames...`;
            await new Promise(r => setTimeout(r, 10));

            prerenderFrames();

            timeline.max = renderedFrames.length - 1;
            timeline.value = 0;
            currentFrame = 0;

            const duration = data.metadata.duration || (data.metadata.frameCount / data.metadata.fps);
            videoInfo.textContent = `${data.metadata.width}x${data.metadata.height} chars | ${data.metadata.fps} fps | ${data.metadata.frameCount} frames | ${formatTime(duration)}`;

            loadingStatus.classList.add('hidden');
            playerContainer.classList.remove('hidden');

            calculateFontSize();
            showFrame(0);
            playBtn.textContent = 'Play';
            isPlaying = false;

        } catch (err) {
            showError(`Failed to load file: ${err.message}`);
        }
    });

    playBtn.addEventListener('click', () => {
        if (isPlaying) {
            pause();
        } else {
            play();
        }
    });

    timeline.addEventListener('input', () => {
        const wasPlaying = isPlaying;
        if (isPlaying) pause();
        showFrame(parseInt(timeline.value));
        if (wasPlaying) play();
    });

    rerenderBtn.addEventListener('click', () => {
        if (!videoData) return;
        const wasPlaying = isPlaying;
        if (isPlaying) pause();
        prerenderFrames();
        showFrame(currentFrame);
        if (wasPlaying) play();
    });

    // Mode toggle handlers
    function setRenderMode(mode) {
        renderMode = mode;
        if (mode === 'ascii') {
            modeAsciiBtn.classList.add('active');
            modeDotsBtn.classList.remove('active');
            charsGroup.classList.remove('hidden');
        } else {
            modeAsciiBtn.classList.remove('active');
            modeDotsBtn.classList.add('active');
            charsGroup.classList.add('hidden');
        }
        // Re-render if video is loaded
        if (videoData) {
            const wasPlaying = isPlaying;
            if (isPlaying) pause();
            prerenderFrames();
            showFrame(currentFrame);
            if (wasPlaying) play();
        }
    }

    modeAsciiBtn.addEventListener('click', () => setRenderMode('ascii'));
    modeDotsBtn.addEventListener('click', () => setRenderMode('dots'));

    window.addEventListener('resize', () => {
        if (videoData) {
            calculateFontSize();
        }
    });

    fullscreenBtn.addEventListener('click', () => {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            playerContainer.requestFullscreen();
        }
    });

    document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement) {
            fullscreenBtn.textContent = 'Exit';
        } else {
            fullscreenBtn.textContent = 'Fullscreen';
        }
        if (videoData) {
            setTimeout(calculateFontSize, 50);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (!videoData) return;

        if (e.code === 'Space') {
            e.preventDefault();
            if (isPlaying) {
                pause();
            } else {
                play();
            }
        } else if (e.code === 'ArrowLeft') {
            e.preventDefault();
            pause();
            showFrame(Math.max(0, currentFrame - 1));
        } else if (e.code === 'ArrowRight') {
            e.preventDefault();
            pause();
            showFrame(Math.min(renderedFrames.length - 1, currentFrame + 1));
        } else if (e.code === 'Home') {
            e.preventDefault();
            pause();
            showFrame(0);
        } else if (e.code === 'End') {
            e.preventDefault();
            pause();
            showFrame(renderedFrames.length - 1);
        }
    });
});
