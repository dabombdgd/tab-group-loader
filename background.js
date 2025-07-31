/**
 * @file Service worker for the Tab Group Loader extension.
 * @description Handles the core logic of creating tab groups from bookmarks.
 */

/**
 * A mapping of color names to their string values.
 * @type {string[]}
 */
const COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

/**
 * Gets the bookmark node for a given folder ID.
 * @param {string} folderId - The ID of the bookmark folder.
 * @returns {Promise<chrome.bookmarks.BookmarkTreeNode | null>} The bookmark node, or null if not found.
 */
async function getBookmarkFolder(folderId) {
  const folderNodes = await new Promise(resolve => chrome.bookmarks.get(folderId, resolve));
  if (!folderNodes || folderNodes.length === 0) {
    console.warn(`Bookmark folder with ID ${folderId} not found. Skipping.`);
    return null;
  }
  return folderNodes[0];
}

/**
 * Gets the links from a given bookmark folder.
 * @param {string} folderId - The ID of the bookmark folder.
 * @returns {Promise<chrome.bookmarks.BookmarkTreeNode[]>} A promise that resolves with an array of bookmark links.
 */
async function getBookmarkLinks(folderId) {
  const nodes = await new Promise(resolve => chrome.bookmarks.getSubTree(folderId, resolve));
  if (!nodes || nodes.length === 0) {
    console.warn(`Could not get subtree for folder ID ${folderId}. Skipping.`);
    return [];
  }
  return nodes[0].children.filter(c => !c.children);
}

/**
 * Creates a new tab group with the given links and properties.
 * @param {chrome.bookmarks.BookmarkTreeNode[]} links - An array of bookmark links.
 * @param {string} title - The title for the new tab group.
 * @param {string} color - The color for the new tab group.
 */
async function createTabGroup(links, title, color) {
  const tabIds = [];
  for (const link of links) {
    const tab = await new Promise(resolve => chrome.tabs.create({ url: link.url, active: false }, resolve));
    tabIds.push(tab.id);
  }

  if (tabIds.length > 0) {
    const groupId = await new Promise(resolve => chrome.tabs.group({ tabIds }, resolve));
    await new Promise(resolve => chrome.tabGroups.update(groupId, { title, color }, resolve));
  }
}

/**
 * Main handler for the 'openTabs' action.
 * @param {object} msg - The message from the popup.
 */
async function handleOpenTabs(msg) {
  let colorIndex = 0;
  for (const folderId of msg.folders) {
    const folder = await getBookmarkFolder(folderId);
    if (!folder) continue;

    const links = await getBookmarkLinks(folderId);
    if (links.length === 0) continue;

    let color;
    if (msg.color === 'random') {
      color = COLORS[colorIndex % COLORS.length];
      colorIndex++;
    } else {
      color = msg.color.toLowerCase();
    }

    await createTabGroup(links, folder.title, color);
  }
}

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.action === 'openTabs') {
    try {
      await handleOpenTabs(msg);
    } catch (error) {
      console.error("Error opening tab groups:", error);
    }
  }
});