import { EngravingRules } from "./EngravingRules";
import { StaffLine } from "./StaffLine";
import { PointF2D } from "../../Common/DataObjects/PointF2D";
import { VexFlowMeasure } from "./VexFlow/VexFlowMeasure";
import { unitInPixels } from "./VexFlow/VexFlowMusicSheetDrawer";
import log from "loglevel";
import { BoundingBox } from "./BoundingBox";
import { SkyBottomLineCalculationResult } from "./SkyBottomLineCalculationResult";
import { CanvasVexFlowBackend } from "./VexFlow/CanvasVexFlowBackend";
/**
 * This class calculates and holds the skyline and bottom line information.
 * It also has functions to update areas of the two lines if new elements are
 * added to the staffline (e.g. measure number, annotations, ...)
 */
export class SkyBottomLineCalculator {
    /** Parent Staffline where the skyline and bottom line is attached */
    private mStaffLineParent: StaffLine;
    /** Internal array for the skyline */
    private mSkyLine: number[];
    /** Internal array for the bottomline */
    private mBottomLine: number[];
    /** Engraving rules for formatting */
    private mRules: EngravingRules;

    /**
     * Create a new object of the calculator
     * @param staffLineParent staffline where the calculator should be attached
     */
    constructor(staffLineParent: StaffLine) {
        this.mStaffLineParent = staffLineParent;
        this.mRules = staffLineParent.ParentMusicSystem.rules;
    }

    /**
     * This method updates the skylines and bottomlines for mStaffLineParent.
     * @param calculationResults the skylines and bottomlines of mStaffLineParent's measures calculated by SkyBottomLineBatchCalculator
     */
    public updateLines(calculationResults: SkyBottomLineCalculationResult[]): void {
        const measures: VexFlowMeasure[] = this.StaffLineParent.Measures as VexFlowMeasure[];

        if (calculationResults.length !== measures.length) {
            log.warn("SkyBottomLineCalculator: lengths of calculation result array and measure array do not match");

            if (calculationResults.length < measures.length) {
                while (calculationResults.length < measures.length) {
                    calculationResults.push(new SkyBottomLineCalculationResult([], []));
                }
            } else {
                calculationResults = calculationResults.slice(0, measures.length);
            }
        }

        const arrayLength: number = Math.max(Math.ceil(this.StaffLineParent.PositionAndShape.Size.width * this.SamplingUnit), 1);
        this.mSkyLine = [];
        this.mBottomLine = [];

        for (const { skyLine, bottomLine } of calculationResults) {
            this.mSkyLine.push(...skyLine);
            this.mBottomLine.push(...bottomLine);
        }

        // Subsampling:
        // The pixel width is bigger than the measure size in units. So we split the array into
        // chunks with the size of MeasurePixelWidth/measureUnitWidth and reduce the value to its
        // average
        const arrayChunkSize: number = this.mSkyLine.length / arrayLength;

        const subSampledSkyLine: number[] = [];
        const subSampledBottomLine: number[] = [];
        for (let chunkIndex: number = 0; chunkIndex < this.mSkyLine.length; chunkIndex += arrayChunkSize) {
            if (subSampledSkyLine.length === arrayLength) {
                break; // TODO find out why skyline.length becomes arrayLength + 1. see log.debug below
            }

            const endIndex: number = Math.min(this.mSkyLine.length, chunkIndex + arrayChunkSize);
            let chunk: number[] = this.mSkyLine.slice(chunkIndex, endIndex + 1); // slice does not include end index
            // TODO chunkIndex + arrayChunkSize is sometimes bigger than this.mSkyLine.length -> out of bounds
            // TODO chunkIndex + arrayChunkSize is often a non-rounded float as well. is that ok to use with slice?
            /*const diff: number = this.mSkyLine.length - (chunkIndex + arrayChunkSize);
            if (diff < 0) { // out of bounds
                console.log("length - slice end index: " + diff);
            }*/

            subSampledSkyLine.push(Math.min(...chunk));
            chunk = this.mBottomLine.slice(chunkIndex, endIndex + 1); // slice does not include end index
            subSampledBottomLine.push(Math.max(...chunk));
        }

        this.mSkyLine = subSampledSkyLine;
        this.mBottomLine = subSampledBottomLine;
        if (this.mSkyLine.length !== arrayLength) { // bottomline will always be same length as well
            log.debug(`SkyLine calculation was not correct (${this.mSkyLine.length} instead of ${arrayLength})`);
        }

        // Remap the values from 0 to +/- height in units
        const lowestSkyLine: number = Math.max(...this.mSkyLine);
        this.mSkyLine = this.mSkyLine.map(v => (v - lowestSkyLine) / unitInPixels + this.StaffLineParent.TopLineOffset);

        const highestBottomLine: number = Math.min(...this.mBottomLine);
        this.mBottomLine = this.mBottomLine.map(v => (v - highestBottomLine) / unitInPixels + this.StaffLineParent.BottomLineOffset);
    }

    /**
     * This method calculates the Sky- and BottomLines for a StaffLine.
     */
    public calculateLines(): void {
        const samplingUnit: number = this.mRules.SamplingUnit;
        const results: SkyBottomLineCalculationResult[] = [];

        // Create a temporary canvas outside the DOM to draw the measure in.
        const tmpCanvas: any = new CanvasVexFlowBackend(this.mRules);
        // search through all Measures
        for (const measure of this.StaffLineParent.Measures as VexFlowMeasure[]) {
            // must calculate first AbsolutePositions
            measure.PositionAndShape.calculateAbsolutePositionsRecursive(0, 0);

            // Pre initialize and get stuff for more performance
            const vsStaff: any = measure.getVFStave();
            let width: number = vsStaff.getWidth();
            if (!(width > 0) && !measure.IsExtraGraphicalMeasure) {
                log.warn("SkyBottomLineCalculator: width not > 0 in measure " + measure.MeasureNumber);
                width = 50;
            }
            // Headless because we are outside the DOM
            tmpCanvas.initializeHeadless(width);
            const ctx: any = tmpCanvas.getContext();
            const canvas: any = tmpCanvas.getCanvas();
            width = canvas.width;
            const height: number = canvas.height;

            // This magic number is an offset from the top image border so that
            // elements above the staffline can be drawn correctly.
            vsStaff.setY(vsStaff.y + 100);
            const oldMeasureWidth: number = vsStaff.getWidth();
            // We need to tell the VexFlow stave about the canvas width. This looks
            // redundant because it should know the canvas but somehow it doesn't.
            // Maybe I am overlooking something but for now this does the trick
            vsStaff.setWidth(width);
            measure.format();
            vsStaff.setWidth(oldMeasureWidth);
            try {
                measure.draw(ctx);
                // Vexflow errors can happen here, then our complete rendering loop would halt without catching errors.
            } catch (ex) {
                log.warn("SkyBottomLineCalculator.calculateLines.draw", ex);
            }

            // imageData.data is a Uint8ClampedArray representing a one-dimensional array containing the data in the RGBA order
            // RGBA is 32 bit word with 8 bits red, 8 bits green, 8 bits blue and 8 bit alpha. Alpha should be 0 for all background colors.
            // Since we are only interested in black or white we can take 32bit words at once
            const imageData: any = ctx.getImageData(0, 0, width, height);
            const rgbaLength: number = 4;
            const measureArrayLength: number = Math.max(Math.ceil(measure.PositionAndShape.Size.width * samplingUnit), 1);
            const tmpSkyLine: number[] = new Array(measureArrayLength);
            const tmpBottomLine: number[] = new Array(measureArrayLength);
            for (let x: number = 0; x < width; x++) {
                // SkyLine
                for (let y: number = 0; y < height; y++) {
                    const yOffset: number = y * width * rgbaLength;
                    const bufIndex: number = yOffset + x * rgbaLength;
                    const alpha: number = imageData.data[bufIndex + 3];
                    if (alpha > 0) {
                        tmpSkyLine[x] = y;
                        break;
                    }
                }
                // BottomLine
                for (let y: number = height; y > 0; y--) {
                    const yOffset: number = y * width * rgbaLength;
                    const bufIndex: number = yOffset + x * rgbaLength;
                    const alpha: number = imageData.data[bufIndex + 3];
                    if (alpha > 0) {
                        tmpBottomLine[x] = y;
                        break;
                    }
                }
            }

            for (let idx: number = 0; idx < tmpSkyLine.length; idx++) {
                if (tmpSkyLine[idx] === undefined) {
                    tmpSkyLine[idx] = Math.max(this.findPreviousValidNumber(idx, tmpSkyLine), this.findNextValidNumber(idx, tmpSkyLine));
                }
            }
            for (let idx: number = 0; idx < tmpBottomLine.length; idx++) {
                if (tmpBottomLine[idx] === undefined) {
                    tmpBottomLine[idx] = Math.max(this.findPreviousValidNumber(idx, tmpBottomLine), this.findNextValidNumber(idx, tmpBottomLine));
                }
            }

            results.push(new SkyBottomLineCalculationResult(tmpSkyLine, tmpBottomLine));

            // Set to true to only show the "mini canvases" and the corresponding skylines
            const debugTmpCanvas: boolean = false;
            if (debugTmpCanvas) {
                tmpSkyLine.forEach((y, x) => this.drawPixel(new PointF2D(x, y), tmpCanvas));
                tmpBottomLine.forEach((y, x) => this.drawPixel(new PointF2D(x, y), tmpCanvas, "blue"));
                const img: any = canvas.toDataURL("image/png");
                document.write('<img src="' + img + '"/>');
            }
            tmpCanvas.clear();
        }

        this.updateLines(results);
    }

    /**
     * This method updates the SkyLine for a given Wedge.
     * @param start Start point of the wedge (the point where both lines meet)
     * @param end End point of the wedge (the end of the most extreme line: upper line for skyline, lower line for bottomline)
     */
    public updateSkyLineWithWedge(start: PointF2D, end: PointF2D): void {
        // FIXME: Refactor if wedges will be added. Current status is that vexflow will be used for this
        let startIndex: number = Math.floor(start.x * this.SamplingUnit);
        let endIndex: number = Math.ceil(end.x * this.SamplingUnit);

        let slope: number = (end.y - start.y) / (end.x - start.x);

        if (endIndex - startIndex <= 1) {
            endIndex++;
            slope = 0;
        }

        if (startIndex < 0) {
            startIndex = 0;
        }
        if (startIndex >= this.BottomLine.length) {
            startIndex = this.BottomLine.length - 1;
        }
        if (endIndex < 0) {
            endIndex = 0;
        }
        if (endIndex >= this.BottomLine.length) {
            endIndex = this.BottomLine.length;
        }

        this.SkyLine[startIndex] = start.y;
        for (let i: number = startIndex + 1; i < Math.min(endIndex, this.SkyLine.length); i++) {
            this.SkyLine[i] = this.SkyLine[i - 1] + slope / this.SamplingUnit;
        }
    }

    /**
     * This method updates the BottomLine for a given Wedge.
     * @param start Start point of the wedge
     * @param end End point of the wedge
     */
    public updateBottomLineWithWedge(start: PointF2D, end: PointF2D): void {
        // FIXME: Refactor if wedges will be added. Current status is that vexflow will be used for this
        let startIndex: number = Math.floor(start.x * this.SamplingUnit);
        let endIndex: number = Math.ceil(end.x * this.SamplingUnit);

        let slope: number = (end.y - start.y) / (end.x - start.x);
        if (endIndex - startIndex <= 1) {
            endIndex++;
            slope = 0;
        }

        if (startIndex < 0) {
            startIndex = 0;
        }
        if (startIndex >= this.BottomLine.length) {
            startIndex = this.BottomLine.length - 1;
        }
        if (endIndex < 0) {
            endIndex = 0;
        }
        if (endIndex >= this.BottomLine.length) {
            endIndex = this.BottomLine.length;
        }

        this.BottomLine[startIndex] = start.y;
        for (let i: number = startIndex + 1; i < endIndex; i++) {
            this.BottomLine[i] = this.BottomLine[i - 1] + slope / this.SamplingUnit;
        }
    }

    /**
     * This method updates the SkyLine for a given range with a given value
     * //param  to update the SkyLine for
     * @param startIndex Start index of the range
     * @param endIndex End index of the range
     * @param value ??
     */
    public updateSkyLineInRange(startIndex: number, endIndex: number, value: number): void {
        this.updateInRange(this.mSkyLine, startIndex, endIndex, value);
    }

    /**
     * This method updates the BottomLine for a given range with a given value
     * @param startIndex Start index of the range
     * @param endIndex End index of the range (excluding)
     * @param value ??
     */
    public updateBottomLineInRange(startIndex: number, endIndex: number, value: number): void {
        this.updateInRange(this.BottomLine, startIndex, endIndex, value);
    }

    /**
     * Resets a SkyLine in a range to its original value
     * @param startIndex Start index of the range
     * @param endIndex End index of the range (excluding)
     */
    public resetSkyLineInRange(startIndex: number, endIndex: number): void {
        this.updateInRange(this.SkyLine, startIndex, endIndex);
    }

    /**
     * Resets a bottom line in a range to its original value
     * @param startIndex Start index of the range
     * @param endIndex End index of the range
     */
    public resetBottomLineInRange(startIndex: number, endIndex: number): void {
        this.setInRange(this.BottomLine, startIndex, endIndex);
    }

    /**
     * Update the whole skyline with a certain value
     * @param value value to be set
     */
    public setSkyLineWithValue(value: number): void {
        this.SkyLine.forEach(sl => sl = value);
    }

    /**
     * Update the whole bottomline with a certain value
     * @param value value to be set
     */
    public setBottomLineWithValue(value: number): void {
        this.BottomLine.forEach(bl => bl = value);
    }

    public getLeftIndexForPointX(x: number, length: number): number {
        const index: number = Math.floor(x * this.SamplingUnit);

        if (index < 0) {
            return 0;
        }

        if (index >= length) {
            return length - 1;
        }

        return index;
    }

    public getRightIndexForPointX(x: number, length: number): number {
        const index: number = Math.ceil(x * this.SamplingUnit);

        if (index < 0) {
            return 0;
        }

        if (index >= length) {
            return length - 1;
        }

        return index;
    }

    /**
     * This method updates the StaffLine Borders with the Sky- and BottomLines Min- and MaxValues.
     */
    public updateStaffLineBorders(): void {
        this.mStaffLineParent.PositionAndShape.BorderTop = this.getSkyLineMin();
        this.mStaffLineParent.PositionAndShape.BorderMarginTop = this.getSkyLineMin();
        this.mStaffLineParent.PositionAndShape.BorderBottom = this.getBottomLineMax();
        this.mStaffLineParent.PositionAndShape.BorderMarginBottom = this.getBottomLineMax();
    }

    /**
     * This method finds the minimum value of the SkyLine.
     */
    public getSkyLineMin(): number {
        return Math.min(...this.SkyLine.filter(s => !isNaN(s)));
    }

    public getSkyLineMinAtPoint(point: number): number {
        const index: number = Math.round(point * this.SamplingUnit);
        return this.mSkyLine[index];
    }

    /**
     * This method finds the SkyLine's minimum value within a given range.
     * @param startIndex Starting index
     * @param endIndex End index (including)
     */
    public getSkyLineMinInRange(startIndex: number, endIndex: number): number {
        return this.getMinInRange(this.SkyLine, startIndex, endIndex);
    }

    /**
     * This method finds the maximum value of the BottomLine.
     */
    public getBottomLineMax(): number {
        return Math.max(...this.BottomLine.filter(s => !isNaN(s)));
    }

    public getBottomLineMaxAtPoint(point: number): number {
        const index: number = Math.round(point * this.SamplingUnit);
        return this.mBottomLine[index];
    }

    /**
     * This method finds the BottomLine's maximum value within a given range.
     * @param startIndex Start index of the range
     * @param endIndex End index of the range (excluding)
     */
    public getBottomLineMaxInRange(startIndex: number, endIndex: number): number {
        return this.getMaxInRange(this.BottomLine, startIndex, endIndex);
    }

    /**
     * This method returns the maximum value of the bottom line around a specific
     * bounding box. Will return undefined if the bounding box is not valid or inside staffline
     * @param boundingBox Bounding box where the maximum should be retrieved from
     * @returns Maximum value inside bounding box boundaries or undefined if not possible
     */
    public getBottomLineMaxInBoundingBox(boundingBox: BoundingBox): number {
        //TODO: Actually it should be the margin. But that one is not implemented
        const startPoint: number = Math.floor(boundingBox.AbsolutePosition.x + boundingBox.BorderLeft);
        const endPoint: number = Math.ceil(boundingBox.AbsolutePosition.x + boundingBox.BorderRight);
        return this.getMaxInRange(this.mBottomLine, startPoint, endPoint);
    }

    /**
     * Updates sky- and bottom line with a boundingBox and its children
     * @param boundingBox Bounding box to be added
     */
    public updateWithBoundingBoxRecursively(boundingBox: BoundingBox): void {
        if (boundingBox.ChildElements && boundingBox.ChildElements.length > 0) {
            this.updateWithBoundingBoxRecursively(boundingBox);
        } else {
            const currentTopBorder: number = boundingBox.BorderTop + boundingBox.AbsolutePosition.y;
            const currentBottomBorder: number = boundingBox.BorderBottom + boundingBox.AbsolutePosition.y;

            if (currentTopBorder < 0) {
                const startPoint: number = Math.floor(boundingBox.AbsolutePosition.x + boundingBox.BorderLeft);
                const endPoint: number = Math.ceil(boundingBox.AbsolutePosition.x + boundingBox.BorderRight) ;

                this.updateInRange(this.mSkyLine, startPoint, endPoint, currentTopBorder);
            } else if (currentBottomBorder > this.StaffLineParent.StaffHeight) {
                const startPoint: number = Math.floor(boundingBox.AbsolutePosition.x + boundingBox.BorderLeft);
                const endPoint: number = Math.ceil(boundingBox.AbsolutePosition.x + boundingBox.BorderRight);

                this.updateInRange(this.mBottomLine, startPoint, endPoint, currentBottomBorder);
            }
        }
    }

    //#region Private methods

    /**
     * go backwards through the skyline array and find a number so that
     * we can properly calculate the average
     * @param start the starting index of the search
     * @param tSkyLine the skyline to search through
     */
     private findPreviousValidNumber(start: number, tSkyLine: number[]): number {
        for (let idx: number = start; idx >= 0; idx--) {
            if (!isNaN(tSkyLine[idx])) {
                return tSkyLine[idx];
            }
        }
        return 0;
    }

    /**
     * go forward through the skyline array and find a number so that
     * we can properly calculate the average
     * @param start the starting index of the search
     * @param tSkyLine the skyline to search through
     */
    private findNextValidNumber(start: number, tSkyLine: Array<number>): number {
        if (start >= tSkyLine.length) {
            return tSkyLine[start - 1];
        }
        for (let idx: number = start; idx < tSkyLine.length; idx++) {
            if (!isNaN(tSkyLine[idx])) {
                return tSkyLine[idx];
            }
        }
        return 0;
    }

    /**
     * Debugging drawing function that can draw single pixels
     * @param coord Point to draw to
     * @param backend the backend to be used
     * @param color the color to be used, default is red
     */
    private drawPixel(coord: PointF2D, backend: CanvasVexFlowBackend, color: string = "#FF0000FF"): void {
        const ctx: any = backend.getContext();
        const oldStyle: string = ctx.fillStyle;
        ctx.fillStyle = color;
        ctx.fillRect(coord.x, coord.y, 2, 2);
        ctx.fillStyle = oldStyle;
    }

    /**
     * Update an array with the value given inside a range. NOTE: will only be updated if value > oldValue
     * @param array Array to fill in the new value
     * @param startIndex start index to begin with (default: 0)
     * @param endIndex end index of array (excluding, default: array length)
     * @param value value to fill in (default: 0)
     */
    private updateInRange(array: number[], startIndex: number = 0, endIndex: number = array.length, value: number = 0): void {
        startIndex = Math.floor(startIndex * this.SamplingUnit);
        endIndex = Math.ceil(endIndex * this.SamplingUnit);

        if (endIndex < startIndex) {
            throw new Error("start index of line is greater than the end index");
        }

        if (startIndex < 0) {
            startIndex = 0;
        }

        if (endIndex > array.length) {
            endIndex = array.length;
        }

        for (let i: number = startIndex; i < endIndex; i++) {
            array[i] = Math.abs(value) > Math.abs(array[i]) ? value : array[i];
        }
    }

    /**
     * Sets the value given to the range inside the array. NOTE: will always update the value
     * @param array Array to fill in the new value
     * @param startIndex start index to begin with (default: 0)
     * @param endIndex end index of array (excluding, default: array length)
     * @param value value to fill in (default: 0)
     */
    private setInRange(array: number[], startIndex: number = 0, endIndex: number = array.length, value: number = 0): void {
        startIndex = Math.floor(startIndex * this.SamplingUnit);
        endIndex = Math.ceil(endIndex * this.SamplingUnit);

        if (endIndex < startIndex) {
            throw new Error("start index of line is greater then the end index");
        }

        if (startIndex < 0) {
            startIndex = 0;
        }

        if (endIndex > array.length) {
            endIndex = array.length;
        }

        for (let i: number = startIndex; i < endIndex; i++) {
            array[i] = value;
        }
    }
    /**
     * Get all values of the selected line inside the given range
     * @param skyBottomArray Skyline or bottom line
     * @param startIndex start index
     * @param endIndex end index (including)
     */
    private getMinInRange(skyBottomArray: number[], startIndex: number, endIndex: number): number {
        startIndex = Math.floor(startIndex * this.SamplingUnit);
        endIndex = Math.ceil(endIndex * this.SamplingUnit);

        if (!skyBottomArray) {
            // Highly questionable
            return Number.MAX_VALUE;
        }

        if (startIndex < 0) {
            startIndex = 0;
        }
        if (startIndex >= skyBottomArray.length) {
            startIndex = skyBottomArray.length - 1;
        }
        if (endIndex < 0) {
            endIndex = 0;
        }
        if (endIndex >= skyBottomArray.length) {
            endIndex = skyBottomArray.length;
        }

        if (startIndex >= 0 && endIndex <= skyBottomArray.length) {
            return Math.min(...skyBottomArray.slice(startIndex, endIndex + 1)); // slice does not include end (index)
        }
    }

    /**
     * Get the maximum value inside the given indices
     * @param skyBottomArray Skyline or bottom line
     * @param startIndex start index
     * @param endIndex end index (including)
     */
    private getMaxInRange(skyBottomArray: number[], startIndex: number, endIndex: number): number {
        startIndex = Math.floor(startIndex * this.SamplingUnit);
        endIndex = Math.ceil(endIndex * this.SamplingUnit);

        if (!skyBottomArray) {
            // Highly questionable
            return Number.MIN_VALUE;
        }

        if (startIndex < 0) {
            startIndex = 0;
        }
        if (startIndex >= skyBottomArray.length) {
            startIndex = skyBottomArray.length - 1;
        }
        if (endIndex < 0) {
            endIndex = 0;
        }
        if (endIndex >= skyBottomArray.length) {
            endIndex = skyBottomArray.length;
        }

        if (startIndex >= 0 && endIndex <= skyBottomArray.length) {
            return Math.max(...skyBottomArray.slice(startIndex, endIndex + 1)); // slice does not include end (index)
        }
    }
    // FIXME: What does this do here?
    // private isStaffLineUpper(): boolean {
    //     const instrument: Instrument = this.StaffLineParent.ParentStaff.ParentInstrument;

    //     if (this.StaffLineParent.ParentStaff === instrument.Staves[0]) {
    //         return true;
    //     } else {
    //         return false;
    //     }
    // }
    // #endregion

    //#region Getter Setter
    /** Sampling units that are used to quantize the sky and bottom line  */
    get SamplingUnit(): number {
        return this.mRules.SamplingUnit;
    }

    /** Parent staffline where the skybottomline calculator is attached to */
    get StaffLineParent(): StaffLine {
        return this.mStaffLineParent;
    }

    /** Get the plain skyline array */
    get SkyLine(): number[] {
        return this.mSkyLine;
    }

    /** Get the plain bottomline array */
    get BottomLine(): number[] {
        return this.mBottomLine;
    }
    //#endregion
}
