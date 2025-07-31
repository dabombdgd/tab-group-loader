/**
 * @file Manages the popup UI and user interactions for the Tab Group Loader extension.
 */

document.addEventListener('DOMContentLoaded', () => {
  /**
   * Service for interacting with the Chrome Bookmarks API.
   */
  const bookmarksApi = {
    getBookmarkBarFolders: () => new Promise((resolve, reject) => {
      chrome.bookmarks.getChildren('1', (nodes) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve(nodes.filter(node => !node.url));
      });
    }),
    getSubfolders: (folderId) => new Promise(resolve => {
      chrome.bookmarks.getSubTree(folderId, nodes => {
        resolve(nodes[0].children ? nodes[0].children.filter(c => c.children) : []);
      });
    }),
  };

  /**
   * Service for interacting with Chrome Storage.
   */
  const storageApi = {
    get: (key) => new Promise(resolve => chrome.storage.local.get(key, result => resolve(result[key]))),
    set: (data) => new Promise(resolve => chrome.storage.local.set(data, resolve)),
  };

  /**
   * Manages the UI state and interactions.
   */
  const UIManager = {
    elements: {
      folderSelect: document.getElementById('folderSelect'),
      subfoldersDiv: document.getElementById('subfolders'),
      openSelectedBtn: document.getElementById('openSelected'),
      savePresetBtn: document.getElementById('savePreset'),
      groupColorSelect: document.getElementById('groupColor'),
      notificationArea: document.getElementById('notification'),
      loadingIndicator: document.getElementById('loading'),
      selectAllBtn: document.getElementById('selectAll'),
      deselectAllBtn: document.getElementById('deselectAll'),
      searchSubfoldersInput: document.getElementById('searchSubfolders'),
      presetNameInput: document.getElementById('presetName'),
      presetsDiv: document.getElementById('presets'),
      recentFoldersDiv: document.getElementById('recentFolders'),
    },
    state: {
      allSubfolders: [],
    },
    initialize: async function() {
      this.bindEventListeners();
      try {
        const folders = await bookmarksApi.getBookmarkBarFolders();
        if (folders.length > 0) {
          this.populateFolderSelect(folders);
          await this.loadSubfolders(folders[0].id);
        } else {
          this.showNotification("No folders found in your bookmarks bar.", "error");
        }
        this.loadPresets();
        this.loadRecentFolders();
        this.showWelcomeMessage();
      } catch (error) {
        console.error("Error initializing extension:", error);
        this.showNotification("Could not load bookmarks.", "error");
      }
    },
    bindEventListeners: function() {
      this.elements.folderSelect.addEventListener('change', e => this.loadSubfolders(e.target.value));
      this.elements.searchSubfoldersInput.addEventListener('input', e => this.renderSubfolders(e.target.value));
      this.elements.openSelectedBtn.addEventListener('click', () => this.openSelected());
      this.elements.savePresetBtn.addEventListener('click', () => this.savePreset());
      this.elements.selectAllBtn.addEventListener('click', () => this.toggleAllSubfolders(true));
      this.elements.deselectAllBtn.addEventListener('click', () => this.toggleAllSubfolders(false));
      this.elements.presetsDiv.addEventListener('click', e => this.handlePresetClick(e));
      this.elements.recentFoldersDiv.addEventListener('click', e => this.handleRecentFolderClick(e));
      this.elements.subfoldersDiv.addEventListener('change', () => this.updateBadge());
    },
    populateFolderSelect: function(folders) {
      this.elements.folderSelect.innerHTML = '';
      folders.forEach(folder => {
        const opt = document.createElement('option');
        opt.value = folder.id;
        opt.textContent = folder.title;
        this.elements.folderSelect.appendChild(opt);
      });
    },
    loadSubfolders: async function(folderId) {
      this.state.allSubfolders = await bookmarksApi.getSubfolders(folderId);
      if (this.state.allSubfolders.length === 0) {
        this.elements.subfoldersDiv.innerHTML = '<div class="empty-state">No subfolders found.</div>';
      } else {
        this.renderSubfolders();
      }
      this.updateBadge();
    },
    renderSubfolders: function(filter = '') {
      this.elements.subfoldersDiv.innerHTML = '';
      const filtered = this.state.allSubfolders.filter(sf => sf.title.toLowerCase().includes(filter.toLowerCase()));
      filtered.forEach(sf => {
        const lbl = document.createElement('label');
        lbl.innerHTML = `<input type="checkbox" value="${sf.id}"> ${sf.title}`;
        this.elements.subfoldersDiv.appendChild(lbl);
      });
      this.updateBadge();
    },
    toggleAllSubfolders: function(checked) {
      this.elements.subfoldersDiv.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = checked);
      this.updateBadge();
    },
    openSelected: async function() {
      const selected = [...this.elements.subfoldersDiv.querySelectorAll('input:checked')].map(i => i.value);
      if (selected.length === 0) {
        this.showNotification('Please select at least one subfolder.', 'error');
        return;
      }
      this.elements.loadingIndicator.classList.remove('hidden');
      this.elements.openSelectedBtn.disabled = true;
      
      const selectedFolderId = this.elements.folderSelect.value;
      const selectedFolderText = this.elements.folderSelect.options[this.elements.folderSelect.selectedIndex].text;
      
      let recents = await storageApi.get('recentFolders') || [];
      recents = recents.filter(f => f.id !== selectedFolderId);
      recents.unshift({ id: selectedFolderId, name: selectedFolderText });
      if (recents.length > 5) recents = recents.slice(0, 5);
      await storageApi.set({ recentFolders: recents });
      this.loadRecentFolders();

      await chrome.runtime.sendMessage({
        action: 'openTabs',
        folders: selected,
        color: this.elements.groupColorSelect.value,
      });

      this.elements.loadingIndicator.classList.add('hidden');
      this.elements.openSelectedBtn.disabled = false;
    },
    savePreset: async function() {
      const selected = [...this.elements.subfoldersDiv.querySelectorAll('input:checked')].map(i => i.value);
      const presetName = this.elements.presetNameInput.value.trim();
      if (!presetName) {
        this.showNotification('Please enter a name for the preset.', 'error');
        return;
      }
      if (selected.length === 0) {
        this.showNotification('Please select at least one subfolder to save.', 'error');
        return;
      }
      const presets = await storageApi.get('presets') || {};
      presets[presetName] = { folder: this.elements.folderSelect.value, subfolders: selected };
      await storageApi.set({ presets });
      this.showNotification(`Preset "${presetName}" saved.`, 'success');
      this.elements.presetNameInput.value = '';
      this.loadPresets();
    },
    loadPresets: async function() {
      this.elements.presetsDiv.innerHTML = '';
      const presets = await storageApi.get('presets') || {};
      for (const name in presets) {
        const presetEl = document.createElement('div');
        presetEl.className = 'preset-item';
        presetEl.innerHTML = `
          <span>${name}</span>
          <div class="button-group">
            <button class="load-preset-btn" data-name="${name}">Load</button>
            <button class="delete-preset-btn secondary" data-name="${name}">Delete</button>
          </div>
        `;
        this.elements.presetsDiv.appendChild(presetEl);
      }
    },
    loadRecentFolders: async function() {
      this.elements.recentFoldersDiv.innerHTML = '';
      const recents = await storageApi.get('recentFolders') || [];
      recents.forEach(folder => {
        const btn = document.createElement('button');
        btn.textContent = folder.name;
        btn.dataset.id = folder.id;
        this.elements.recentFoldersDiv.appendChild(btn);
      });
    },
    handlePresetClick: async function(e) {
      const presetName = e.target.dataset.name;
      if (e.target.classList.contains('load-preset-btn')) {
        const presets = await storageApi.get('presets');
        const preset = presets[presetName];
        this.elements.folderSelect.value = preset.folder;
        await this.loadSubfolders(preset.folder);
        preset.subfolders.forEach(id => {
          const checkbox = this.elements.subfoldersDiv.querySelector(`input[value="${id}"]`);
          if (checkbox) checkbox.checked = true;
        });
        this.showNotification(`Preset "${presetName}" loaded.`, 'success');
        this.updateBadge();
      } else if (e.target.classList.contains('delete-preset-btn')) {
        const presets = await storageApi.get('presets');
        delete presets[presetName];
        await storageApi.set({ presets });
        this.showNotification(`Preset "${presetName}" deleted.`, 'success');
        this.loadPresets();
      }
    },
    handleRecentFolderClick: async function(e) {
      if (e.target.tagName === 'BUTTON') {
        const folderId = e.target.dataset.id;
        this.elements.folderSelect.value = folderId;
        await this.loadSubfolders(folderId);
      }
    },
    showNotification: function(message, type) {
      const notification = this.elements.notificationArea;
      notification.textContent = message;
      // Set classes for styling and visibility
      notification.className = `notification ${type} visible`;

      // Hide it after 3 seconds
      setTimeout(() => {
        notification.classList.remove('visible');
      }, 3000);
    },
    showWelcomeMessage: async function() {
      const hasSeenWelcome = await storageApi.get('hasSeenWelcome');
      if (!hasSeenWelcome) {
        this.showNotification('Welcome! Select a folder, choose subfolders, and click Open.', 'info');
        storageApi.set({ hasSeenWelcome: true });
      }
    },
    updateBadge: function() {
      const count = this.elements.subfoldersDiv.querySelectorAll('input:checked').length;
      chrome.action.setBadgeText({ text: count > 0 ? count.toString() : '' });
      chrome.action.setBadgeBackgroundColor({ color: '#007aff' });
    },
  };

  UIManager.initialize();
});