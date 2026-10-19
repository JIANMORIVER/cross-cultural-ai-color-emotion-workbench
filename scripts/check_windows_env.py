from __future__ import annotations

import platform
import sys

import matplotlib
import numpy
import openpyxl
import pandas
import scipy
import seaborn
import skimage
import sklearn

print("Chromalab Windows environment: OK")
print("Python:", sys.version.replace("\n", " "))
print("Platform:", platform.platform())
print("numpy:", numpy.__version__)
print("scipy:", scipy.__version__)
print("scikit-learn:", sklearn.__version__)
print("scikit-image:", skimage.__version__)
print("matplotlib:", matplotlib.__version__)
print("seaborn:", seaborn.__version__)
print("pandas:", pandas.__version__)
print("openpyxl:", openpyxl.__version__)
