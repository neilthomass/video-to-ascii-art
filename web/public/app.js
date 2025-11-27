document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('convertForm');
    const submitBtn = document.getElementById('submitBtn');
    const progressDiv = document.getElementById('progress');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const resultDiv = document.getElementById('result');
    const outputVideo = document.getElementById('outputVideo');
    const downloadMp4Btn = document.getElementById('downloadMp4');
    const downloadGifBtn = document.getElementById('downloadGif');
    const errorDiv = document.getElementById('error');
    const errorMessage = document.getElementById('errorMessage');
    const previewDiv = document.getElementById('preview');
    const previewCanvas = document.getElementById('previewCanvas');
    const thresholdInput = document.getElementById('threshold');
    const thresholdValue = document.getElementById('thresholdValue');
    const contrastInput = document.getElementById('contrast');
    const contrastValue = document.getElementById('contrastValue');
    const exposureInput = document.getElementById('exposure');
    const exposureValue = document.getElementById('exposureValue');
    const videoInput = document.getElementById('video');
    const widthInput = document.getElementById('width');
    const charsInput = document.getElementById('chars');

    let currentResult = null;
    let previewVideo = null;
    let previewSourceCanvas = null;

    // Preview functionality
    videoInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) {
            previewDiv.classList.add('hidden');
            return;
        }

        // Create video element to extract first frame
        previewVideo = document.createElement('video');
        previewVideo.muted = true;
        previewVideo.playsInline = true;

        previewVideo.onloadedmetadata = () => {
            // Seek to random frame in middle 50% of video
            const duration = previewVideo.duration;
            const start = duration * 0.25;
            const end = duration * 0.75;
            previewVideo.currentTime = start + Math.random() * (end - start);
        };

        previewVideo.onseeked = () => {
            // Capture frame after seek
            previewSourceCanvas = document.createElement('canvas');
            previewSourceCanvas.width = previewVideo.videoWidth;
            previewSourceCanvas.height = previewVideo.videoHeight;
            const ctx = previewSourceCanvas.getContext('2d');
            ctx.drawImage(previewVideo, 0, 0);

            previewDiv.classList.remove('hidden');
            updatePreview();
        };

        previewVideo.src = URL.createObjectURL(file);
    });

    function updatePreview() {
        if (!previewSourceCanvas) return;

        const width = parseInt(widthInput.value) || 120;
        const chars = charsInput.value || 'F$V* ';
        const threshold = parseInt(thresholdInput.value) || 240;
        const contrast = parseInt(contrastInput.value) || 100;
        const exposure = parseInt(exposureInput.value) || 0;

        const converter = new VideoToAsciiConverter({
            asciiChars: chars,
            noiseLevel: 0,
            whiteThreshold: threshold,
            contrast: contrast,
            exposure: exposure
        });

        converter.frameToAscii(previewSourceCanvas, previewCanvas, width);
    }

    thresholdInput.addEventListener('input', () => {
        thresholdValue.textContent = thresholdInput.value;
        updatePreview();
    });

    contrastInput.addEventListener('input', () => {
        contrastValue.textContent = contrastInput.value;
        updatePreview();
    });

    exposureInput.addEventListener('input', () => {
        exposureValue.textContent = exposureInput.value;
        updatePreview();
    });

    widthInput.addEventListener('input', updatePreview);
    charsInput.addEventListener('input', updatePreview);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const fpsInput = document.getElementById('fps');
        const noiseLevelInput = document.getElementById('noiseLevel');

        if (!videoInput.files[0]) {
            alert('Please select a video file');
            return;
        }

        const fps = parseInt(fpsInput.value) || 15;
        const width = parseInt(widthInput.value) || 120;
        const chars = charsInput.value || 'F$V* ';
        const noiseLevel = (parseInt(noiseLevelInput.value) || 15) / 100;
        const threshold = parseInt(thresholdInput.value) || 240;
        const contrast = parseInt(contrastInput.value) || 100;
        const exposure = parseInt(exposureInput.value) || 0;

        if (fps < 1 || fps > 30) {
            alert('FPS must be between 1 and 30');
            return;
        }

        if (width < 40 || width > 720) {
            alert('Width must be between 40 and 720');
            return;
        }

        submitBtn.disabled = true;
        progressDiv.classList.remove('hidden');
        resultDiv.classList.add('hidden');
        errorDiv.classList.add('hidden');
        progressBar.style.width = '0%';
        progressText.textContent = 'Loading video...';

        try {
            const converter = new VideoToAsciiConverter({
                asciiChars: chars,
                noiseLevel: noiseLevel,
                whiteThreshold: threshold,
                contrast: contrast,
                exposure: exposure,
                onProgress: (progress) => {
                    progressBar.style.width = `${progress.percent}%`;

                    switch (progress.stage) {
                        case 'loading':
                            progressText.textContent = 'Loading video...';
                            break;
                        case 'extracting':
                            progressText.textContent = `Extracting frames: ${progress.current}/${progress.total}`;
                            break;
                        case 'converting':
                            progressText.textContent = `Converting to ASCII: ${progress.current}/${progress.total}`;
                            break;
                        case 'encoding':
                            progressText.textContent = `Encoding MP4: ${progress.current || ''}/${progress.total || ''}`;
                            break;
                        case 'complete':
                            progressText.textContent = 'Complete!';
                            break;
                    }
                }
            });

            const result = await converter.convert(videoInput.files[0], {
                fps,
                asciiWidth: width
            });

            currentResult = result;

            progressDiv.classList.add('hidden');
            resultDiv.classList.remove('hidden');

            const videoUrl = URL.createObjectURL(result.blob);
            outputVideo.src = videoUrl;

            // Update button text based on format
            downloadMp4Btn.textContent = result.format === 'mp4' ? 'Download MP4' : 'Download WebM';

        } catch (err) {
            console.error('Conversion error:', err);
            progressDiv.classList.add('hidden');
            errorDiv.classList.remove('hidden');
            errorMessage.textContent = err.message || 'Unknown error occurred';
        } finally {
            submitBtn.disabled = false;
        }
    });

    downloadMp4Btn.addEventListener('click', () => {
        if (!currentResult) return;

        const url = URL.createObjectURL(currentResult.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = currentResult.format === 'mp4' ? 'ascii-video.mp4' : 'ascii-video.webm';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    downloadGifBtn.addEventListener('click', async () => {
        if (!currentResult || !currentResult.frames) {
            alert('No frames available for GIF creation');
            return;
        }

        downloadGifBtn.disabled = true;
        downloadGifBtn.textContent = 'Creating GIF...';

        try {
            const gif = new GIF({
                workers: 2,
                quality: 10,
                width: currentResult.width,
                height: currentResult.height,
                workerScript: 'gif.worker.js'
            });

            const delay = Math.round(1000 / currentResult.fps);

            for (let i = 0; i < currentResult.frames.length; i++) {
                const img = new Image();
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                    img.src = currentResult.frames[i].data;
                });
                gif.addFrame(img, { delay });
            }

            gif.on('finished', (blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'ascii-video.gif';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                downloadGifBtn.disabled = false;
                downloadGifBtn.textContent = 'Download GIF';
            });

            gif.render();

        } catch (err) {
            console.error('GIF creation error:', err);
            alert('Failed to create GIF: ' + err.message);
            downloadGifBtn.disabled = false;
            downloadGifBtn.textContent = 'Download GIF';
        }
    });
});
