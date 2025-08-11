// Fetch albums from Immich and store in storage
async function fetchAndStoreAlbums() {
    const { api_url } = await browser.storage.sync.get("api_url");
    const { api_key } = await browser.storage.sync.get("api_key");
    if (!api_url || !api_key) return;
    try {
        const res = await fetch(api_url + "/albums", {
            headers: { "x-api-key": api_key }
        });
        if (!res.ok) throw new Error("Failed to fetch albums");
        const albums = await res.json();
        await browser.storage.local.set({ immich_albums: albums });
        return albums;
    } catch (e) {
        console.error("Error fetching albums:", e);
        await browser.storage.local.set({ immich_albums: [] });
        return [];
    }
}

// Create context menu for each album
async function createAlbumMenus() {
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({
        id: "upload-immich",
        title: "Upload image/video to Immich",
        contexts: ["image", "video"],
    });
    const { immich_albums } = await browser.storage.local.get("immich_albums");
    if (immich_albums && Array.isArray(immich_albums)) {
        for (const album of immich_albums) {
            browser.contextMenus.create({
                id: `upload-immich-album-${album.id}`,
                parentId: "upload-immich",
                title: album.albumName || album.name || `Album ${album.id}`,
                contexts: ["image", "video"],
            });
        }
    }
}


// Remove initial load. Instead, update albums and menus when context menu is about to show
browser.contextMenus.onShown.addListener(async () => {
    await fetchAndStoreAlbums();
    await createAlbumMenus();
});

// Listen for reload message from options
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg === "reload_albums") {
        fetchAndStoreAlbums().then(createAlbumMenus).then(() => sendResponse({ ok: true }));
        return true;
    }
});

// Open options page when extension icon is clicked
browser.action.onClicked.addListener(() => {
    if (browser.runtime.openOptionsPage) {
        browser.runtime.openOptionsPage();
    } else {
        window.open(browser.runtime.getURL("options.html"));
    }
});

browser.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === "upload-immich") {
        const imageUrl = info.srcUrl;
        immichUpload(imageUrl);
    } else if (info.menuItemId.startsWith("upload-immich-album-")) {
        const albumId = info.menuItemId.replace("upload-immich-album-", "");
        const imageUrl = info.srcUrl;
        immichUpload(imageUrl, albumId);
    }
});

async function immichUpload(imgUrl, albumId) {
    const imgResponse = await fetch(imgUrl);
    const img = await imgResponse.blob();
    const date = new Date();
    const fileNameArr = imgUrl.split("/");
    const fileName = fileNameArr[fileNameArr.length - 1].split("?")[0];
    const imgFile = new File([img], fileName);
    const formData = new FormData();
    formData.append("deviceAssetId", fileName + date.getTime());
    formData.append("deviceId", "Extension");
    formData.append("fileCreatedAt", date.toISOString());
    formData.append("fileModifiedAt", date.toISOString());
    formData.append("assetData", imgFile);
    const { api_key } = await browser.storage.sync.get("api_key");
    const { api_url } = await browser.storage.sync.get("api_url");
    let response = await fetch(api_url + "/assets", {
        method: "post",
        headers: {
            "x-api-key": api_key,
            "Accept": "application/json",
        },
        body: formData
    });
    if (!response.ok) {
        console.error("Failed to upload image:", response.statusText);
        return;
    }
    const asset = await response.json();
    if (!asset || !asset.id || !asset.status || asset.status !== "created") {
        console.error("Invalid asset response:", asset);
        return;
    }
    if (albumId) {
        response = await fetch(api_url + `/albums/${albumId}/assets`, {
            method: "put",
            headers: {
                "x-api-key": api_key,
                "Accept": "application/json",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ ids: [asset.id] })
        });
        if (!response.ok) {
            console.error("Failed to add asset to album:", response.statusText);
        } else {
            console.log("Image uploaded and added to album successfully.");
        }
    } else {
        console.log("Image uploaded successfully.");
    }
}
