Put the trained AgroPest-12 checkpoint here as `best_yolov8s_agropest12.pt` (or `best.pt`).
Weights are not committed (see .gitignore). The service refuses to start with any model whose
classes are not exactly the 12 AgroPest-12 classes (e.g. the stock COCO `yolov8s.pt`).
