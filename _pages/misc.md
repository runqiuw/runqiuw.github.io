---
layout: page
title: misc
permalink: /misc/
description: My hobbies, interests, photo gallery, and more.
nav: true
nav_order: 10
---

<div class="schedule-embed">
  <iframe
    id="schedule-frame"
    src="{{ '/assets/html/schedule.html' | relative_url }}"
    title="2026 Summer Schedule"
    loading="lazy"
    scrolling="no"
    style="width: 100%; height: 600px; border: 0; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: block; overflow: hidden;">
  </iframe>
</div>

<script>
  window.addEventListener('message', function (e) {
    if (e && e.data && e.data.type === 'schedule-resize' && typeof e.data.height === 'number') {
      var frame = document.getElementById('schedule-frame');
      if (frame) frame.style.height = e.data.height + 'px';
    }
  });
</script>
