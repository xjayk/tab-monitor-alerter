(function() {
  if (!window.Notification) return;

  const OriginalNotification = window.Notification;

  window.Notification = function(title, options) {
    // Alert the isolated script
    window.postMessage({ type: 'TAB_ALERTER_NOTIFICATION' }, '*');
    return new OriginalNotification(title, options);
  };

  // Maintain original static properties/methods (like .requestPermission)
  Object.assign(window.Notification, OriginalNotification);
  window.Notification.prototype = OriginalNotification.prototype;
})();
