---
layout: page
title: misc
permalink: /misc/
description: My hobbies, interests, and photo gallery.
nav: false
nav_order: 10
---

## 兴趣爱好

这里可以展示你的兴趣爱好、个人爱好等内容。

### 示例分类

你可以在这里添加你的兴趣爱好，比如：

- **摄影**：喜欢拍摄风景、人像等
- **旅行**：探索不同的城市和文化
- **阅读**：喜欢阅读各种类型的书籍
- **音乐**：欣赏和演奏音乐
- **运动**：参与各种体育活动

---

## Gallery

这里展示一些照片和图片。

### 照片集 1

<div class="row mt-3">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid path="assets/img/9.jpg" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid path="assets/img/7.jpg" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid path="assets/img/8.jpg" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    照片集 1 的说明文字
</div>

### 照片集 2 (Lightbox Gallery)

使用 Lightbox2 创建可点击放大的图片画廊：

<div class="row mt-3">
    <div class="col-sm mt-3 mt-md-0">
        <a href="{{ 'assets/img/9.jpg' | relative_url }}" data-lightbox="gallery1">
            <img src="{{ 'assets/img/9.jpg' | relative_url }}" class="img-fluid rounded z-depth-1" />
        </a>
    </div>
    <div class="col-sm mt-3 mt-md-0">
        <a href="{{ 'assets/img/7.jpg' | relative_url }}" data-lightbox="gallery1">
            <img src="{{ 'assets/img/7.jpg' | relative_url }}" class="img-fluid rounded z-depth-1" />
        </a>
    </div>
    <div class="col-sm mt-3 mt-md-0">
        <a href="{{ 'assets/img/8.jpg' | relative_url }}" data-lightbox="gallery1">
            <img src="{{ 'assets/img/8.jpg' | relative_url }}" class="img-fluid rounded z-depth-1" />
        </a>
    </div>
</div>
<div class="caption">
    点击图片可以放大查看
</div>

### 照片集 3

<div class="row mt-3">
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid path="assets/img/10.jpg" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
    <div class="col-sm mt-3 mt-md-0">
        {% include figure.liquid path="assets/img/11.jpg" class="img-fluid rounded z-depth-1" zoomable=true %}
    </div>
</div>
<div class="caption">
    照片集 3 的说明文字
</div>

---

## 其他内容

你可以在这里添加任何其他想要展示的内容。

