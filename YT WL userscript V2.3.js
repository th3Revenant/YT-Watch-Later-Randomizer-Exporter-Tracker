// ==UserScript==
// @name         YouTube Watch Later Randomizer, Exporter & Tracker
// @namespace    http://tampermonkey.net/
// @version      2.3
// @description  Preloads, tracks, updates, randomizes, and exports YouTube Watch Later playlist with detailed metadata.
// @author       You
// @match        https://www.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// ==/UserScript==

(function() {
    'use strict';

    // --- Helper Functions ---

    function extractVideoId(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.searchParams.get('v');
        } catch (e) {
            return null;
        }
    }

    function formatDate(isoString) {
        if (!isoString) return "Never";
        const d = new Date(isoString);
        const pad = n => n.toString().padStart(2, '0');
        
        let hours = d.getHours();
        const ampm = hours >= 12 ? 'pm' : 'am';
        
        hours = hours % 12;
        hours = hours ? hours : 12; // execution rule: hour '0' should be '12'

        return `${pad(hours)}:${pad(d.getMinutes())} ${ampm} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
    }

    // Standard scanner for internal tracking ID array
    async function scanPlaylist(btnElement) {
        const originalText = btnElement.innerText;
        const originalColor = btnElement.style.backgroundColor;
        
        btnElement.disabled = true;
        btnElement.style.backgroundColor = '#555555';
        btnElement.innerText = '⏳ Scanning...';

        let lastVideoCount = 0;
        let currentVideoCount = 0;
        let scrollAttemptsWithoutNewVideos = 0;

        while (scrollAttemptsWithoutNewVideos < 3) {
            const videos = document.querySelectorAll('ytd-playlist-video-renderer');
            currentVideoCount = videos.length;

            if (currentVideoCount > lastVideoCount) {
                lastVideoCount = currentVideoCount;
                scrollAttemptsWithoutNewVideos = 0;
                btnElement.innerText = `⏳ Loaded ${currentVideoCount}...`;
            } else {
                scrollAttemptsWithoutNewVideos++;
            }

            window.scrollTo(0, document.documentElement.scrollHeight);
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        const videoElements = document.querySelectorAll('ytd-playlist-video-renderer a#video-title');
        const videoIds = [];

        videoElements.forEach(el => {
            const id = extractVideoId(el.href);
            if (id && !videoIds.includes(id)) {
                videoIds.push(id);
            }
        });

        btnElement.innerText = originalText;
        btnElement.style.backgroundColor = originalColor;
        btnElement.disabled = false;

        return videoIds;
    }

    // Deep metadata scanner optimized for text exporting layouts
    async function scanPlaylistDeep(btnElement) {
        const originalText = btnElement.innerText;
        const originalColor = btnElement.style.backgroundColor;
        
        btnElement.disabled = true;
        btnElement.style.backgroundColor = '#555555';
        btnElement.innerText = '⏳ Compiling Metadata...';

        let lastVideoCount = 0;
        let currentVideoCount = 0;
        let scrollAttemptsWithoutNewVideos = 0;

        while (scrollAttemptsWithoutNewVideos < 3) {
            const videos = document.querySelectorAll('ytd-playlist-video-renderer');
            currentVideoCount = videos.length;

            if (currentVideoCount > lastVideoCount) {
                lastVideoCount = currentVideoCount;
                scrollAttemptsWithoutNewVideos = 0;
                btnElement.innerText = `⏳ Scanning ${currentVideoCount}...`;
            } else {
                scrollAttemptsWithoutNewVideos++;
            }

            window.scrollTo(0, document.documentElement.scrollHeight);
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        const renderers = document.querySelectorAll('ytd-playlist-video-renderer');
        const detailedItems = [];

        renderers.forEach(row => {
            const titleEl = row.querySelector('#video-title');
            if (!titleEl) return;

            const link = titleEl.href ? titleEl.href.split('&list=')[0] : 'No link available';
            const rawTitle = titleEl.innerText ? titleEl.innerText.trim() : 'Unknown Title';
            
            const uploaderEl = row.querySelector('#text.ytd-channel-name') || row.querySelector('#channel-name a');
            const uploader = uploaderEl ? uploaderEl.innerText.trim() : 'Unknown Uploader';
            
            // YouTube displays relative upload time info in the secondary metadata spans
            const metaSpans = row.querySelectorAll('#metadata-line span');
            let uploadDate = 'Unknown upload date';
            if (metaSpans.length > 1) {
                uploadDate = metaSpans[1].innerText.trim();
            } else if (metaSpans.length === 1 && !metaSpans[0].innerText.includes('views')) {
                uploadDate = metaSpans[0].innerText.trim();
            }

            // Detect unavailability categories via parsing text nodes
            let isUnavailable = false;
            let reason = 'Unavailable';

            const dynamicReasonText = row.parentElement?.innerText || '';
            const lowerTitle = rawTitle.toLowerCase();

            if (lowerTitle.includes('private video')) {
                isUnavailable = true;
                reason = 'Privated';
            } else if (lowerTitle.includes('deleted video')) {
                isUnavailable = true;
                reason = 'Deleted';
            } else if (dynamicReasonText.includes('copyright') || lowerTitle.includes('copyright')) {
                isUnavailable = true;
                reason = 'Removed due to copyright';
            } else if (dynamicReasonText.includes('terminated') || dynamicReasonText.includes('banned')) {
                isUnavailable = true;
                reason = 'Channel Banned';
            }

            detailedItems.push({
                title: rawTitle,
                uploader: uploader,
                link: link,
                uploadDate: uploadDate,
                isUnavailable: isUnavailable,
                reason: reason
            });
        });

        btnElement.innerText = originalText;
        btnElement.style.backgroundColor = originalColor;
        btnElement.disabled = false;

        return detailedItems;
    }

    // --- UI Injection (Trusted Types Safe) ---

    function createStatRow(parent, label, spanId, colorCode) {
        const row = document.createElement('div');
        const boldText = document.createElement('strong');
        boldText.innerText = label + ' ';
        
        const valueSpan = document.createElement('span');
        valueSpan.id = spanId;
        valueSpan.innerText = spanId === 'wl-stat-date' ? 'Never' : '0';
        if (colorCode) valueSpan.style.color = colorCode;

        row.appendChild(boldText);
        row.appendChild(valueSpan);
        parent.appendChild(row);
    }

    function injectUI() {
        if (document.getElementById('yt-wl-tracker-container')) return;
        if (!document.body) return;

        // Main Container
        const container = document.createElement('div');
        container.id = 'yt-wl-tracker-container';
        container.style.position = 'fixed';
        container.style.bottom = '30px';
        container.style.right = '30px';
        container.style.zIndex = '999999'; 
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.alignItems = 'flex-end';
        container.style.gap = '15px';
        container.style.fontFamily = 'Roboto, Arial, sans-serif';

        // The Menu Panel
        const menu = document.createElement('div');
        menu.id = 'yt-wl-menu';
        menu.style.display = 'none';
        menu.style.backgroundColor = '#0F0F0F';
        menu.style.border = '1px solid #3F3F3F';
        menu.style.color = '#FFFFFF';
        menu.style.padding = '15px';
        menu.style.borderRadius = '12px';
        menu.style.boxShadow = '0 10px 20px rgba(0,0,0,0.8)';
        menu.style.width = '300px';
        menu.style.flexDirection = 'column';
        menu.style.gap = '10px';

        // Stats Display Panel
        const statsPanel = document.createElement('div');
        statsPanel.style.fontSize = '13px';
        statsPanel.style.lineHeight = '1.6';
        statsPanel.style.color = '#AAAAAA';
        statsPanel.style.marginBottom = '5px';
        statsPanel.style.paddingBottom = '10px';
        statsPanel.style.borderBottom = '1px solid #3F3F3F';

        createStatRow(statsPanel, 'List date:', 'wl-stat-date', null);
        createStatRow(statsPanel, 'OG list items:', 'wl-stat-og', null);
        createStatRow(statsPanel, 'Added items:', 'wl-stat-added', '#4CAF50');
        createStatRow(statsPanel, 'Removed items:', 'wl-stat-removed', '#FF5252');

        const btnStyle = `
            width: 100%; padding: 10px; margin-bottom: 8px; border: none; border-radius: 8px;
            font-size: 14px; font-weight: bold; cursor: pointer; transition: 0.2s;
        `;

        const preloadBtn = document.createElement('button');
        preloadBtn.innerText = '💾 Preload the list';
        preloadBtn.style.cssText = btnStyle + 'background-color: #272727; color: white;';
        
        const updateBtn = document.createElement('button');
        updateBtn.innerText = '🔄 Update the list';
        updateBtn.style.cssText = btnStyle + 'background-color: #272727; color: white;';

        const exportBtn = document.createElement('button');
        exportBtn.innerText = '📤 Export text list';
        exportBtn.style.cssText = btnStyle + 'background-color: #1F3A60; color: white;';

        const openRandomBtn = document.createElement('button');
        openRandomBtn.innerText = '🚀 Open a random video';
        openRandomBtn.style.cssText = btnStyle + 'background-color: #FF0000; color: white;';

        const copyRandomBtn = document.createElement('button');
        copyRandomBtn.innerText = '📋 Copy random video URL';
        copyRandomBtn.style.cssText = btnStyle + 'background-color: #272727; color: white;';

        [preloadBtn, updateBtn, exportBtn, openRandomBtn, copyRandomBtn].forEach(btn => {
            btn.onmouseover = () => btn.style.filter = 'brightness(1.2)';
            btn.onmouseout = () => btn.style.filter = 'brightness(1)';
            menu.appendChild(btn);
        });

        menu.prepend(statsPanel);

        // Floating Action Pin Button
        const fab = document.createElement('button');
        fab.innerText = '🎲';
        fab.style.width = '60px';
        fab.style.height = '60px';
        fab.style.borderRadius = '50%';
        fab.style.backgroundColor = '#FF0000';
        fab.style.color = '#FFFFFF';
        fab.style.border = 'none';
        fab.style.fontSize = '30px';
        fab.style.cursor = 'pointer';
        fab.style.boxShadow = '0 4px 10px rgba(0,0,0,0.5)';
        fab.style.display = 'flex';
        fab.style.justifyContent = 'center';
        fab.style.alignItems = 'center';
        fab.style.transition = 'transform 0.2s';

        fab.onmouseover = () => fab.style.transform = 'scale(1.1)';
        fab.onmouseout = () => fab.style.transform = 'scale(1)';

        fab.addEventListener('click', () => {
            if (menu.style.display === 'none') {
                menu.style.display = 'flex';
                updateStatsUI(); 
            } else {
                menu.style.display = 'none';
            }
        });

        container.appendChild(menu);
        container.appendChild(fab);
        document.body.appendChild(container);

        // --- Core Application Event Logic ---

        function updateStatsUI() {
            const data = GM_getValue('wl_data', { date: null, originalList: [], currentList: [], addedCount: 0, removedCount: 0 });

            const dateEl = document.getElementById('wl-stat-date');
            const ogEl = document.getElementById('wl-stat-og');
            const addedEl = document.getElementById('wl-stat-added');
            const removedEl = document.getElementById('wl-stat-removed');

            if (dateEl) dateEl.innerText = formatDate(data.date);
            if (ogEl) ogEl.innerText = data.originalList.length;
            if (addedEl) addedEl.innerText = data.addedCount;
            if (removedEl) removedEl.innerText = data.removedCount;

            const hasVideos = data.currentList.length > 0;
            openRandomBtn.disabled = !hasVideos;
            copyRandomBtn.disabled = !hasVideos;
            openRandomBtn.style.opacity = hasVideos ? '1' : '0.5';
            copyRandomBtn.style.opacity = hasVideos ? '1' : '0.5';
        }

        preloadBtn.addEventListener('click', async () => {
            const videoIds = await scanPlaylist(preloadBtn);
            const newData = { date: new Date().toISOString(), originalList: videoIds, currentList: videoIds, addedCount: 0, removedCount: 0 };
            GM_setValue('wl_data', newData);
            updateStatsUI();
            preloadBtn.innerText = '✅ Preloaded!';
            setTimeout(() => preloadBtn.innerText = '💾 Preload the list', 2000);
        });

        updateBtn.addEventListener('click', async () => {
            let data = GM_getValue('wl_data');
            if (!data || !data.originalList || data.originalList.length === 0) {
                alert("Please 'Preload the list' first!");
                return;
            }
            const newVideoIds = await scanPlaylist(updateBtn);
            const addedItems = newVideoIds.filter(id => !data.originalList.includes(id));
            const removedItems = data.originalList.filter(id => !newVideoIds.includes(id));

            data.currentList = newVideoIds;
            data.addedCount = addedItems.length;
            data.removedCount = removedItems.length;
            
            GM_setValue('wl_data', data);
            updateStatsUI();

            updateBtn.innerText = '✅ Updated!';
            setTimeout(() => updateBtn.innerText = '🔄 Update the list', 2000);
        });

        // Action Handler: Scrapes deep details layout and packages an automated text document download
        exportBtn.addEventListener('click', async () => {
            const detailedMetadataItems = await scanPlaylistDeep(exportBtn);
            
            if (detailedMetadataItems.length === 0) {
                alert("No videos found to export! Make sure you are logged in and looking at your playlist items.");
                return;
            }

            const timestampHeader = formatDate(new Date().toISOString());
            let fileContentString = `${timestampHeader}\n\n`;

            detailedMetadataItems.forEach(item => {
                if (item.isUnavailable) {
                    fileContentString += `VIDEO IS UNAVAILABLE + ${item.reason}\n${item.link}\n\n`;
                } else {
                    fileContentString += `${item.uploader} - ${item.title}\n${item.uploadDate}\n${item.link}\n\n`;
                }
            });

            // Strip the very final redundant trail trailing lines
            fileContentString = fileContentString.trimEnd();

            try {
                const blob = new Blob([fileContentString], { type: 'text/plain;charset=utf-8' });
                const downloadAnchorElement = document.createElement('a');
                downloadAnchorElement.href = URL.createObjectURL(blob);
                downloadAnchorElement.download = `YouTube_WatchLater_Export.txt`;
                document.body.appendChild(downloadAnchorElement);
                downloadAnchorElement.click();
                document.body.removeChild(downloadAnchorElement);

                exportBtn.innerText = '✅ Exported!';
            } catch (err) {
                console.error("Export text routine failed: ", err);
                exportBtn.innerText = '❌ Export Failed';
            }

            setTimeout(() => exportBtn.innerText = '📤 Export text list', 2000);
        });

        openRandomBtn.addEventListener('click', () => {
            const data = GM_getValue('wl_data');
            if (data && data.currentList && data.currentList.length > 0) {
                const randomIndex = Math.floor(Math.random() * data.currentList.length);
                const chosenId = data.currentList[randomIndex];
                GM_openInTab(`https://www.youtube.com/watch?v=${chosenId}`, { active: true });
            }
        });

        copyRandomBtn.addEventListener('click', () => {
            const data = GM_getValue('wl_data');
            if (data && data.currentList && data.currentList.length > 0) {
                const randomIndex = Math.floor(Math.random() * data.currentList.length);
                const chosenId = data.currentList[randomIndex];
                GM_setClipboard(`https://www.youtube.com/watch?v=${chosenId}`, 'text');
                copyRandomBtn.innerText = '✅ Copied!';
                setTimeout(() => copyRandomBtn.innerText = '📋 Copy random video URL', 2000);
            }
        });

        updateStatsUI();
    }

    // --- Dom Insertion Loop ---
    setInterval(() => {
        if (window.location.href.includes('playlist?list=WL')) {
            injectUI();
        } else {
            const container = document.getElementById('yt-wl-tracker-container');
            if (container) container.remove();
        }
    }, 500);

})();